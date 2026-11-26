package com.socialtask.wecom;

import com.socialtask.auth.AuthService;
import com.socialtask.common.*;
import com.socialtask.notification.WecomGateway;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;

@Service
public class WecomInboxService {
    private final Db db;private final Audit audit;private final WecomGateway gateway;
    public WecomInboxService(Db db,Audit audit,WecomGateway gateway){this.db=db;this.audit=audit;this.gateway=gateway;}
    @Value("${app.wecom.retention-days:90}") private int retentionDays;
    @Transactional public void receive(Map<String,String> xml){
        String user=xml.get("FromUserName");String type=xml.get("MsgType");
        if(user==null||user.isBlank()||user.length()>128||type==null||type.length()>32) throw new SecurityException("企业微信消息缺少合法发送人或类型");
        String key=xml.get("MsgId");
        if(key==null||key.isBlank())key=AuthService.sha256(String.join("|",user,xml.getOrDefault("CreateTime",""),xml.getOrDefault("Event",""),xml.getOrDefault("EventKey",""),xml.getOrDefault("Content","")));
        String hash=AuthService.sha256("WECOM_APP:"+key);
        var matches=db.list("SELECT id FROM people WHERE wecom_userid=? AND status='ACTIVE' LIMIT 2",user);
        long personId=matches.size()==1?Db.id(matches.getFirst()):0; // Ambiguous or unbound IDs must not be auto-attributed.
        db.execute("INSERT INTO wecom_conversations(channel,peer_userid,person_id,last_message_at) VALUES('WECOM_APP',?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE person_id=VALUES(person_id)",user,personId==0?null:personId);
        var thread=db.one("SELECT id FROM wecom_conversations WHERE channel='WECOM_APP' AND peer_userid=? FOR UPDATE",user);
        long threadId=Db.id(thread);
        if(db.optional("SELECT id FROM wecom_messages WHERE msg_key=?",hash)!=null) return; // WeCom retries callback delivery.
        String content;
        if("text".equals(type)) content=xml.getOrDefault("Content","");
        else if(Set.of("image","voice","video").contains(type)) content="["+type+" 媒体消息：原件须在有效期内授权下载]";
        else if("link".equals(type)) content="[链接消息] "+xml.getOrDefault("Title","")+"\n"+xml.getOrDefault("Description","")+"\n"+xml.getOrDefault("Url","");
        else if("location".equals(type)) content="[位置消息] "+xml.getOrDefault("Label","");
        else if("event".equals(type)) content="[应用事件："+xml.getOrDefault("Event","unknown")+"]";
        else content="["+type+" 类型消息：请在企业微信中查看原件]";
        if(content.length()>4000)content=content.substring(0,4000);
        Instant when=Instant.now();
        try{long timestamp=Long.parseLong(xml.getOrDefault("CreateTime",""));if(timestamp>0&&Math.abs(timestamp-when.getEpochSecond())<86400)when=Instant.ofEpochSecond(timestamp);}catch(NumberFormatException ignored){}
        db.execute("INSERT INTO wecom_messages(conversation_id,msg_key,direction,message_type,content,provider_msgid,message_at) VALUES(?,?,'INBOUND',?,?,?,?)",
            threadId,hash,type.toUpperCase(Locale.ROOT),content,xml.get("MsgId"),Db.stamp(when));
        if(Set.of("image","voice","video").contains(type)&&WecomMediaPolicy.validMediaId(xml.get("MediaId")))
            db.execute("UPDATE wecom_messages SET provider_media_id=? WHERE msg_key=?",xml.get("MediaId"),hash);
        db.execute("UPDATE wecom_conversations SET unread_count=unread_count+1,last_message_at=GREATEST(last_message_at,?) WHERE id=?",Db.stamp(when),threadId);
    }
    public List<Map<String,Object>> threads(String q){
        Access.admin();
        String base="SELECT c.*,p.name AS person_name,p.group_name,(SELECT m.content FROM wecom_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message FROM wecom_conversations c LEFT JOIN people p ON p.id=c.person_id ";
        if(q==null||q.isBlank())return db.list(base+"ORDER BY c.last_message_at DESC LIMIT 300");
        return db.list(base+"WHERE c.peer_userid LIKE ? OR p.name LIKE ? ORDER BY c.last_message_at DESC LIMIT 300","%"+q.trim()+"%","%"+q.trim()+"%");
    }
    public List<Map<String,Object>> messages(long threadId){Access.admin();db.one("SELECT id FROM wecom_conversations WHERE id=?",threadId);return db.list("SELECT id,conversation_id,direction,message_type,content,provider_msgid,message_at,CASE WHEN delivery_status='SENDING' AND created_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE) THEN 'UNKNOWN' ELSE delivery_status END AS delivery_status,media_filename,media_bytes,(provider_media_id IS NOT NULL AND message_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 3 DAY)) AS media_available FROM wecom_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 200",threadId);}
    @Transactional public Map<String,Object> markRead(long threadId){Access.admin();db.execute("UPDATE wecom_conversations SET unread_count=0 WHERE id=?",threadId);return db.one("SELECT * FROM wecom_conversations WHERE id=?",threadId);}
    @Scheduled(cron="0 30 3 * * *",zone="Asia/Shanghai") @Transactional public void purge(){
        if(retentionDays<1||retentionDays>3650)return;
        // Preserve referential integrity and ticket provenance, not expired message bodies.
        db.execute("UPDATE wecom_messages m JOIN tasks t ON t.source_message_id=m.id SET m.content=NULL,m.provider_msgid=NULL,m.provider_media_id=NULL,m.media_filename=NULL,m.media_bytes=NULL,m.delivery_status='REDACTED' WHERE m.message_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY) AND m.delivery_status<>'REDACTED'",retentionDays);
        db.execute("DELETE m FROM wecom_messages m LEFT JOIN tasks t ON t.source_message_id=m.id WHERE t.id IS NULL AND m.message_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY)",retentionDays);
    }
}
