package com.socialtask.notification;

import com.socialtask.common.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

/** Claims each notification with one atomic UPDATE … RETURNING before calling the external API. */
@Service
public class NotificationService {
    private final Db db;private final WecomGateway gateway;private final Audit audit;
    @org.springframework.beans.factory.annotation.Value("${app.scheduler.enabled:true}") private boolean enabled;
    public NotificationService(Db db,WecomGateway gateway,Audit audit){this.db=db;this.gateway=gateway;this.audit=audit;}
    @Scheduled(fixedDelayString="15000",initialDelayString="10000") public void tick(){if(enabled)dispatch();}
    public Map<String,Object> dispatch(){
        int processed=0,accepted=0,failed=0;
        // A crashed worker may already have sent its card. Never reclaim an ambiguous send.
        db.execute("UPDATE notifications SET state='UNKNOWN',last_error='发送结果未知，请人工核对' WHERE state='SENDING' AND attempted_at < (CURRENT_TIMESTAMP - INTERVAL '5 minutes')");
        for(int i=0;i<40;i++){
            // 单条语句原子认领：PostgREST 每次调用即一个事务，不能依赖跨请求的行锁。
            Map<String,Object> notice=db.optional("UPDATE notifications SET state='SENDING',send_attempts=send_attempts+1,"
                +"attempted_at=CURRENT_TIMESTAMP WHERE id=(SELECT id FROM notifications WHERE state='PENDING' "
                +"ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *");
            if(notice==null) break;
            if(notice.get("person_id")!=null){
                var person=db.optional("SELECT wecom_userid FROM people WHERE id=?",notice.get("person_id"));
                if(person!=null){var merged=new LinkedHashMap<>(notice);merged.put("wecom_userid",person.get("wecom_userid"));notice=merged;}
            }
            long id=Db.id(notice);
            if(!gateway.configured()||notice.get("wecom_userid")==null||Db.str(notice.get("wecom_userid")).isBlank()){
                db.execute("UPDATE notifications SET state='NOT_CONFIGURED',last_error='应用发送未启用或人员未绑定企业微信' WHERE id=? AND state='SENDING'",id);processed++;continue;
            }
            try{
                String platformMsgid=gateway.sendTextCard(Db.str(notice.get("wecom_userid")),"SocialTask 任务通知",Db.str(notice.get("details")),notice.get("task_id")==null?null:Db.l(notice.get("task_id")));
                db.execute("UPDATE notifications SET state='SENT',sent_at=CURRENT_TIMESTAMP,provider_msgid=?,last_error=NULL WHERE id=? AND state='SENDING'",platformMsgid,id);
                accepted++;
            }catch(WecomGateway.Rejected error){
                db.execute("UPDATE notifications SET state='FAILED',last_error='企业微信明确拒绝请求' WHERE id=? AND state='SENDING'",id);failed++;
            }catch(Exception error){
                if(error instanceof InterruptedException)Thread.currentThread().interrupt();
                db.execute("UPDATE notifications SET state='UNKNOWN',last_error='发送结果未知，请人工核对' WHERE id=? AND state='SENDING'",id);failed++;
            }
            processed++;
        }
        return Map.of("processed",processed,"accepted_by_api",accepted,"failed_attempts",failed,"wecom_configured",gateway.configured());
    }
    public List<Map<String,Object>> list(){Access.admin();return db.list("SELECT n.*,p.name AS recipient_name FROM notifications n LEFT JOIN people p ON p.id=n.person_id ORDER BY n.id DESC LIMIT 300");}
    @Transactional public Map<String,Object> retry(long id){
        var actor=Access.admin();var notice=db.one("SELECT id,state FROM notifications WHERE id=? FOR UPDATE",id);
        if(!Set.of("FAILED","NOT_CONFIGURED").contains(notice.get("state")))throw new ApiException(409,"仅发送失败或未配置消息可以重试");
        db.execute("UPDATE notifications SET state='PENDING',send_attempts=0,attempted_at=NULL,last_error=NULL WHERE id=?",id);
        audit.record(actor.id(),"notification",id,"RETRY",Map.of("previous_state",notice.get("state")));
        return db.one("SELECT id,state FROM notifications WHERE id=?",id);
    }
}
