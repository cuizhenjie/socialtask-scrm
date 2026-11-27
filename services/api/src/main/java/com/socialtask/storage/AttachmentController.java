package com.socialtask.storage;

import com.socialtask.common.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.transaction.annotation.Transactional;
import java.io.IOException;
import java.io.ByteArrayInputStream;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/attachments")
public class AttachmentController {
    private final Db db;private final Audit audit;private final Path root;
    private final int pmRetentionDays;private final int contentRetentionDays;
    public AttachmentController(Db db,Audit audit,@Value("${app.upload-dir:./var/uploads}") String directory,
                                @Value("${app.attachments.private-message-retention-days:90}") int pmRetentionDays,
                                @Value("${app.attachments.content-retention-days:0}") int contentRetentionDays) throws IOException {
        this.db=db;this.audit=audit;this.root=Paths.get(directory).toAbsolutePath().normalize();
        this.pmRetentionDays=pmRetentionDays;this.contentRetentionDays=contentRetentionDays;
        Files.createDirectories(root);
    }
    private static String sniff(byte[] bytes) {
        String candidate;
        if(bytes.length>=8 && bytes[0]==(byte)0x89 && bytes[1]==0x50 && bytes[2]==0x4e && bytes[3]==0x47 && bytes[4]==0x0d) candidate="image/png";
        else if(bytes.length>=3 && bytes[0]==(byte)0xff && bytes[1]==(byte)0xd8 && bytes[2]==(byte)0xff) candidate="image/jpeg";
        else throw new ApiException(400,"只允许真实 PNG/JPEG 图片文件");
        // A magic-header check alone is insufficient: validate supported image metadata and decodability.
        try(ImageInputStream stream=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            if(stream==null) throw new IOException("invalid image");
            var readers=ImageIO.getImageReaders(stream);
            if(!readers.hasNext()) throw new IOException("no image reader");
            ImageReader reader=readers.next();
            try {
                reader.setInput(stream,true,true);
                int width=reader.getWidth(0),height=reader.getHeight(0);
                if(width<1 || width>4096 || height<1 || height>4096 || ((long)width*height)>12_000_000L)
                    throw new IOException("image exceeds pixel limit");
                if(reader.read(0)==null) throw new IOException("image decoding failed");
                String detected=reader.getFormatName().toLowerCase(Locale.ROOT);
                boolean correctFormat = (candidate.equals("image/png") && detected.equals("png"))
                   || (candidate.equals("image/jpeg") && (detected.equals("jpeg") || detected.equals("jpg")));
                if(!correctFormat) throw new IOException("format mismatch");
            } finally {reader.dispose();}
            return candidate;
        } catch(Exception e) {throw new ApiException(400,"图片内容无法解析、尺寸超限或格式不一致");}
    }
    @PostMapping(consumes=MediaType.MULTIPART_FORM_DATA_VALUE) @Transactional public Map<String,Object> upload(@RequestParam("purpose") String purpose,@RequestPart("file") MultipartFile file) throws IOException {
        var actor=Access.who();
        if(!Set.of("CONTENT","PRIVATE_MESSAGE").contains(purpose)) throw new ApiException(400,"附件用途不合法");
        if(purpose.equals("CONTENT")) Access.admin();
        if(file.isEmpty() || file.getSize()>5L*1024*1024) throw new ApiException(400,"图片大小须为 1B–5MB");
        byte[] body=file.getBytes();String mime=sniff(body);
        String key=UUID.randomUUID().toString().replace("-","")+UUID.randomUUID().toString().replace("-","");
        String name=file.getOriginalFilename()==null?"attachment":file.getOriginalFilename().replaceAll("[\\r\\n\\u0000/\\\\]","_");
        if(name.length()>200) name=name.substring(name.length()-200);
        Path filePath=root.resolve(key).normalize();
        if(!filePath.startsWith(root)) throw new ApiException(400,"无效文件路径");
        Files.write(filePath,body,StandardOpenOption.CREATE_NEW);
        try {
            int days=purpose.equals("PRIVATE_MESSAGE")?pmRetentionDays:contentRetentionDays;
            Instant retentionUntil=(days>=1&&days<=3650)?Instant.now().plus(Duration.ofDays(days)):null;
            long id=db.insert("INSERT INTO attachments(owner_user_id,purpose,filename,storage_key,mime,file_size,retention_until) VALUES(?,?,?,?,?,?,?)",
                actor.id(),purpose,name,key,mime,body.length,retentionUntil==null?null:Db.stamp(retentionUntil));
            audit.record(actor.id(),"attachment",id,"UPLOAD",Map.of("purpose",purpose,"size",body.length));
            Map<String,Object> res=new LinkedHashMap<>();
            res.put("id",id);res.put("filename",name);res.put("mime",mime);res.put("file_size",body.length);
            if(retentionUntil!=null) res.put("retention_until",retentionUntil.toString());
            return res;
        } catch(RuntimeException e) {Files.deleteIfExists(filePath);throw e;}
    }
    @GetMapping("/{id}") public ResponseEntity<Resource> download(@PathVariable long id) throws IOException {
        var actor=Access.who(); var meta=db.one("SELECT * FROM attachments WHERE id=?",id);
        String purpose=Db.str(meta.get("purpose"));
        if(purpose.equals("PRIVATE_MESSAGE") && !Access.isAdmin()) throw new ApiException(403,"私信截图仅管理人员可下载");
        if(purpose.equals("CONTENT") && !Access.isAdmin()) {
            if(actor.personId()==null) throw new ApiException(403,"无素材访问权限");
            String jsonId=db.json(id);
            Map<String,Object> allowed=db.optional("SELECT t.id FROM tasks t JOIN publish_batches b ON b.id=t.batch_id JOIN content_packages p ON p.id=b.content_id WHERE t.assignee_id=? AND (p.asset_ids_json @> CAST(? AS jsonb)) LIMIT 1",actor.personId(),jsonId);
            if(allowed==null) allowed=db.optional("SELECT t.id FROM tasks t JOIN ticket_material_assets m ON m.task_id=t.id WHERE t.assignee_id=? AND m.attachment_id=? AND t.status NOT IN ('CANCELLED','STOPPED') LIMIT 1",actor.personId(),id);
            if(allowed==null) throw new ApiException(403,"无素材访问权限");
        }
        if(meta.get("purged_at")!=null) throw new ApiException(410,"该附件已超过保留期并按隐私策略清理");
        String key=Db.str(meta.get("storage_key"));Path filePath=root.resolve(key).normalize();
        if(!filePath.startsWith(root) || !Files.isRegularFile(filePath)) throw new ApiException(404,"附件文件不存在");
        var headers=new HttpHeaders();headers.setContentType(MediaType.parseMediaType(Db.str(meta.get("mime"))));
        headers.setContentDisposition(ContentDisposition.attachment().filename(Db.str(meta.get("filename")),StandardCharsets.UTF_8).build());
        headers.setCacheControl(CacheControl.noStore());
        headers.set("X-Content-Type-Options","nosniff");
        return ResponseEntity.ok().headers(headers).body(new FileSystemResource(filePath));
    }
}
