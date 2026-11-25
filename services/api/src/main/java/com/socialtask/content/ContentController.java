package com.socialtask.content;

import com.socialtask.common.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@RestController
@RequestMapping("/api/v1/content-packages")
public class ContentController {
    private final Db db; private final Audit audit;
    public ContentController(Db db,Audit audit){this.db=db;this.audit=audit;}
    public record PackageIn(String title,String body,String hashtags,List<Long> assetIds) {}
    public record ReviewIn(String decision) {}
    @GetMapping public List<Map<String,Object>> list() {Access.admin();return db.list("SELECT * FROM content_packages ORDER BY id DESC LIMIT 300");}
    @PostMapping @Transactional public Map<String,Object> create(@RequestBody PackageIn body) {
        var actor=Access.admin();Db.required(body.title(),"标题",220);Db.required(body.body(),"正文",60000);
        List<Long> assets=body.assetIds()==null?List.of():body.assetIds();
        for(long id:assets) db.one("SELECT id FROM attachments WHERE id=? AND purpose='CONTENT'",id);
        long id=db.insert("INSERT INTO content_packages(title,body,hashtags,asset_ids_json,created_by) VALUES(?,?,?,?,?)",body.title(),body.body(),body.hashtags()==null?"":body.hashtags(),db.json(assets),actor.id());
        audit.record(actor.id(),"content",id,"CREATE",Map.of("title",body.title()));
        return db.one("SELECT * FROM content_packages WHERE id=?",id);
    }
    @PostMapping("/{id}/review") @Transactional public Map<String,Object> review(@PathVariable long id,@RequestBody ReviewIn body){
        var actor=Access.admin();var pack=db.one("SELECT * FROM content_packages WHERE id=? FOR UPDATE",id);
        Db.ensure("DRAFT".equals(pack.get("review_status")),"素材仅可从草稿审核");
        if(!Set.of("APPROVE","REJECT").contains(body.decision())) throw new ApiException(400,"审核结论错误");
        String status=body.decision().equals("APPROVE")?"APPROVED":"REJECTED";
        db.execute("UPDATE content_packages SET review_status=?,reviewed_by=? WHERE id=?",status,actor.id(),id);
        audit.record(actor.id(),"content",id,"REVIEW",Map.of("status",status));
        return db.one("SELECT * FROM content_packages WHERE id=?",id);
    }
}
