package com.socialtask.wecom;

import com.socialtask.auth.AuthService;
import com.socialtask.common.*;
import com.socialtask.notification.WecomGateway;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
public class WecomDispatchService {
    private final Db db;private final Audit audit;private final WecomGateway gateway;private final TransactionTemplate tx;
    public WecomDispatchService(Db db,Audit audit,WecomGateway gateway,PlatformTransactionManager manager){this.db=db;this.audit=audit;this.gateway=gateway;this.tx=new TransactionTemplate(manager);}
    public boolean configured(){return gateway.configured();}
    public boolean mediaConfigured(){return gateway.mediaConfigured();}
    private record Claim(long id,String user,boolean fresh){}
    private static final String VIEW="SELECT id,conversation_id,direction,message_type,content,provider_msgid,message_at,CASE WHEN delivery_status='SENDING' AND created_at < (CURRENT_TIMESTAMP - INTERVAL '5 minutes') THEN 'UNKNOWN' ELSE delivery_status END AS delivery_status,media_filename,media_bytes FROM wecom_messages WHERE id=?";
    public Map<String,Object> text(long thread,String request,String content){
        Access.admin();String clean=Db.required(content,"回复内容",1000);
        Db.badIf(clean.getBytes(StandardCharsets.UTF_8).length>2048,"文本超过 2048 UTF-8 字节");
        return send(thread,request,"TEXT",clean,AuthService.sha256(clean),null);
    }
    public Map<String,Object> media(long thread,String request,WecomMediaPolicy.Upload upload){
        Access.admin();return send(thread,request,upload.type().toUpperCase(Locale.ROOT),"[发送媒体] "+upload.filename(),WecomMediaPolicy.digest(upload.bytes()),upload);
    }
    private Map<String,Object> send(long threadId,String request,String type,String content,String digest,WecomMediaPolicy.Upload upload){
        var actor=Access.admin();
        Db.badIf(request==null||!request.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"),"请求编号须为 UUID");
        String key=AuthService.sha256("OUT_REQ:"+actor.id()+":"+threadId+":"+request.toLowerCase(Locale.ROOT));
        String fingerprint=AuthService.sha256(type+":"+digest+":"+content);
        Claim claim=tx.execute(status->{
            var thread=db.one("SELECT * FROM wecom_conversations WHERE id=? FOR UPDATE",threadId);
            Db.ensure("WECOM_APP".equals(thread.get("channel")),"仅自建应用会话支持此发送接口");
            var previous=db.optional("SELECT id,request_fingerprint FROM wecom_messages WHERE msg_key=?",key);
            if(previous!=null){Db.ensure(fingerprint.equals(previous.get("request_fingerprint")),"同一请求编号不能更换消息内容");return new Claim(Db.id(previous),null,false);}
            Db.ensure(gateway.configured()&&(upload==null||gateway.mediaConfigured()),"应用出站或媒体未完成配置");
            Db.ensure(thread.get("person_id")!=null,"未绑定成员禁止直接回复");
            String uid=Db.str(thread.get("peer_userid"));
            var matches=db.list("SELECT id,wecom_userid FROM people WHERE wecom_userid=? AND status='ACTIVE' LIMIT 2",uid);
            Db.ensure(matches.size()==1&&Db.id(matches.getFirst())==Db.l(thread.get("person_id"))&&uid.equals(Db.str(matches.getFirst().get("wecom_userid"))),"成员已停用、绑定冲突或 UserID 已变更");
            long id=db.insert("INSERT INTO wecom_messages(conversation_id,msg_key,direction,message_type,content,message_at,delivery_status,request_fingerprint,media_filename,media_bytes) VALUES(?,?,'OUTBOUND',?,?,CURRENT_TIMESTAMP,'SENDING',?,?,?)",
                threadId,key,type,content,fingerprint,upload==null?null:upload.filename(),upload==null?null:upload.bytes().length);
            db.execute("UPDATE wecom_conversations SET last_message_at=CURRENT_TIMESTAMP WHERE id=?",threadId);
            audit.record(actor.id(),"wecom_message",id,"SEND_CLAIM",Map.of("thread",threadId,"type",type));
            return new Claim(id,uid,true);
        });
        if(!claim.fresh())return db.one(VIEW,claim.id());
        String state,provider=null;
        try{provider=upload==null?gateway.sendText(claim.user(),content):gateway.sendMedia(claim.user(),upload);state="ACCEPTED";}
        catch(WecomGateway.Rejected e){state="FAILED";}
        catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();state="UNKNOWN";}
        final String outcome=state,providerId=provider;
        tx.executeWithoutResult(status->{
            db.execute("UPDATE wecom_messages SET delivery_status=?,provider_msgid=? WHERE id=? AND delivery_status='SENDING'",outcome,providerId,claim.id());
            audit.record(actor.id(),"wecom_message",claim.id(),"SEND_RESULT",Map.of("state",outcome));
        });
        return db.one(VIEW,claim.id());
    }
    public byte[] download(long id){
        var actor=Access.admin();
        if(!gateway.mediaConfigured())throw new ApiException(409,"媒体下载未启用");
        var row=db.optional("SELECT m.provider_media_id FROM wecom_messages m JOIN wecom_conversations c ON c.id=m.conversation_id WHERE m.id=? AND c.channel='WECOM_APP' AND m.direction='INBOUND' AND m.delivery_status='RECEIVED' AND m.message_type IN ('IMAGE','VOICE','VIDEO') AND m.message_at > (CURRENT_TIMESTAMP - INTERVAL '3 days')",id);
        if(row==null||!WecomMediaPolicy.validMediaId(Db.str(row.get("provider_media_id"))))throw new ApiException(404,"媒体不存在、已清理或超过有效期");
        byte[] bytes;
        try{bytes=gateway.downloadMedia(Db.str(row.get("provider_media_id")));}catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new ApiException(502,"媒体暂不可下载，请核对授权及有效期");}
        audit.record(actor.id(),"wecom_message",id,"MEDIA_DOWNLOAD",Map.of("bytes",bytes.length));
        return bytes;
    }
}
