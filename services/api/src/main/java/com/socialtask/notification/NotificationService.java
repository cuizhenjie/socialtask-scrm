package com.socialtask.notification;

import com.socialtask.common.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

/** Short DB claim transactions; never hold a DB lock while waiting for an external HTTP API. */
@Service
public class NotificationService {
    private final Db db;private final WecomGateway gateway;private final TransactionTemplate tx;private final Audit audit;
    @org.springframework.beans.factory.annotation.Value("${app.scheduler.enabled:true}") private boolean enabled;
    public NotificationService(Db db,WecomGateway gateway,PlatformTransactionManager manager,Audit audit){this.db=db;this.gateway=gateway;this.tx=new TransactionTemplate(manager);this.audit=audit;}
    @Scheduled(fixedDelayString="15000",initialDelayString="10000") public void tick(){if(enabled)dispatch();}
    public Map<String,Object> dispatch(){
        int processed=0,accepted=0,failed=0;
        for(int i=0;i<40;i++){
            Map<String,Object> notice=tx.execute(status->{
                var row=db.optional("SELECT n.*,p.wecom_userid FROM notifications n LEFT JOIN people p ON p.id=n.person_id "
                    +"WHERE n.state='PENDING' OR (n.state='RETRY' AND n.attempted_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 60 SECOND)) "
                    +"OR (n.state='SENDING' AND n.attempted_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE)) "
                    +"ORDER BY n.id LIMIT 1 FOR UPDATE SKIP LOCKED");
                if(row!=null)db.execute("UPDATE notifications SET state='SENDING',send_attempts=send_attempts+1,attempted_at=UTC_TIMESTAMP(3) WHERE id=?",Db.id(row));
                return row;
            });
            if(notice==null) break;
            long id=Db.id(notice);int attempt=Db.n(notice.get("send_attempts"))+1;
            if(!gateway.configured()||notice.get("wecom_userid")==null||Db.str(notice.get("wecom_userid")).isBlank()){
                db.execute("UPDATE notifications SET state='NOT_CONFIGURED',last_error='应用发送未启用或人员未绑定企业微信' WHERE id=? AND state='SENDING'",id);processed++;continue;
            }
            try{
                String platformMsgid=gateway.sendTextCard(Db.str(notice.get("wecom_userid")),"SocialTask 任务通知",Db.str(notice.get("details")),notice.get("task_id")==null?null:Db.l(notice.get("task_id")));
                db.execute("UPDATE notifications SET state='SENT',sent_at=UTC_TIMESTAMP(3),provider_msgid=?,last_error=NULL WHERE id=? AND state='SENDING'",platformMsgid,id);
                accepted++;
            }catch(Exception error){
                String message=error.getMessage()==null?"unknown":error.getMessage();if(message.length()>400)message=message.substring(0,400);
                db.execute("UPDATE notifications SET state=?,last_error=? WHERE id=? AND state='SENDING'",attempt>=3?"FAILED":"RETRY",message,id);failed++;
            }
            processed++;
        }
        return Map.of("processed",processed,"accepted_by_api",accepted,"failed_attempts",failed,"wecom_configured",gateway.configured());
    }
    public List<Map<String,Object>> list(){Access.admin();return db.list("SELECT n.*,p.name AS recipient_name FROM notifications n LEFT JOIN people p ON p.id=n.person_id ORDER BY n.id DESC LIMIT 300");}
    @Transactional public Map<String,Object> retry(long id){
        var actor=Access.admin();var notice=db.one("SELECT id,state FROM notifications WHERE id=? FOR UPDATE",id);
        if(!Set.of("FAILED","NOT_CONFIGURED","RETRY").contains(notice.get("state")))throw new ApiException(409,"仅发送失败或未配置消息可以重试");
        db.execute("UPDATE notifications SET state='PENDING',send_attempts=0,attempted_at=NULL,last_error=NULL WHERE id=?",id);
        audit.record(actor.id(),"notification",id,"RETRY",Map.of("previous_state",notice.get("state")));
        return db.one("SELECT id,state FROM notifications WHERE id=?",id);
    }
}
