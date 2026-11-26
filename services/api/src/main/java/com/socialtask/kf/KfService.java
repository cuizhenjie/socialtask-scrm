package com.socialtask.kf;

import com.socialtask.common.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import java.time.*;
import java.util.*;

@Service
public class KfService {
    private final Db db;private final Audit audit;private final KfSyncClient client;private final TransactionTemplate tx;
    public KfService(Db db,Audit audit,KfSyncClient client,PlatformTransactionManager manager){this.db=db;this.audit=audit;this.client=client;this.tx=new TransactionTemplate(manager);}
    private static void admin(){if(!"admin".equals(Access.who().role()))throw new ApiException(403,"仅系统管理员可访问微信客服数据");}
    private void ready(){admin();if(!client.configured())throw new ApiException(409,"微信客服未启用或未完成授权配置");}
    private record Claim(String account,String cursor,String lease){}
    public Map<String,Object> state(){
        admin();Map<String,Object> result=new LinkedHashMap<>();
        result.put("enabled",client.enabled());result.put("authorized",client.authorized());result.put("configured",client.configured());result.put("retention_days",client.retentionDays());
        result.put("mode","MANUAL_READ_ONLY");result.put("has_more",false);
        if(client.configured()){
            var row=db.optional("SELECT last_attempt_at,last_sync_at,has_more,last_error FROM kf_sync_state WHERE account_key=?",client.accountKey());
            if(row!=null)result.putAll(row);
        }
        return result;
    }
    public Map<String,Object> sync(boolean confirm){
        ready();if(!confirm)throw new ApiException(400,"须明确确认本次仅同步授权客服账号的会话数据");
        String account=client.accountKey();long actor=Access.who().id();
        Claim claim=tx.execute(status->{
            db.execute("INSERT INTO kf_sync_state(account_key) VALUES(?) ON DUPLICATE KEY UPDATE account_key=account_key",account);
            var row=db.one("SELECT * FROM kf_sync_state WHERE account_key=? FOR UPDATE",account);
            Instant now=Instant.now();
            if(row.get("lease_until")!=null&&Db.instant(row.get("lease_until")).isAfter(now))throw new ApiException(409,"已有同步任务执行中");
            if(row.get("last_attempt_at")!=null&&Db.instant(row.get("last_attempt_at")).plusSeconds(60).isAfter(now))throw new ApiException(429,"同步限频：每 60 秒最多一次");
            String lease=UUID.randomUUID().toString();
            db.execute("UPDATE kf_sync_state SET lease_id=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND),last_attempt_at=UTC_TIMESTAMP(3) WHERE account_key=?",lease,account);
            return new Claim(account,Objects.toString(row.get("cursor_value"),""),lease);
        });
        try{
            KfPage page=client.fetch(claim.cursor());
            return tx.execute(status->{
                var current=db.one("SELECT lease_id FROM kf_sync_state WHERE account_key=? FOR UPDATE",account);
                Db.ensure(claim.lease().equals(current.get("lease_id")),"同步租约已失效，游标未推进");
                int processed=0;
                for(var m:page.messages()){
                    if(m.time().isBefore(Instant.now().minus(Duration.ofDays(client.retentionDays()))))continue;
                    boolean alreadyRecalled=m.peer()!=null&&db.optional("SELECT id FROM kf_messages WHERE account_key=? AND peer_key=? AND recall_target_key=? LIMIT 1",account,m.peer(),m.key())!=null;
                    db.execute("INSERT INTO kf_messages(account_key,peer_key,message_key,origin,message_type,content,message_at,recalled,recall_target_key) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",
                        account,m.peer(),m.key(),m.origin(),m.type().toUpperCase(Locale.ROOT),alreadyRecalled?null:m.content(),Db.stamp(m.time()),alreadyRecalled,m.recallTarget());
                    if(m.recallTarget()!=null)db.execute("UPDATE kf_messages SET content=NULL,recalled=TRUE WHERE account_key=? AND peer_key=? AND message_key=?",account,m.peer(),m.recallTarget());
                    processed++;
                }
                db.execute("UPDATE kf_sync_state SET cursor_value=?,has_more=?,last_sync_at=UTC_TIMESTAMP(3),last_error=NULL,lease_id=NULL,lease_until=NULL WHERE account_key=? AND lease_id=?",page.cursor(),page.hasMore(),account,claim.lease());
                audit.record(actor,"kf_sync",0,"SYNC_PAGE",Map.of("processed",processed,"has_more",page.hasMore()));
                return Map.of("processed",processed,"has_more",page.hasMore(),"mode","MANUAL_READ_ONLY");
            });
        }catch(RuntimeException e){
            db.execute("UPDATE kf_sync_state SET last_error='同步失败，游标未推进',lease_id=NULL,lease_until=NULL WHERE account_key=? AND lease_id=?",account,claim.lease());
            if(e instanceof ApiException known)throw known;
            throw new ApiException(502,"微信客服同步失败；游标未推进");
        }
    }
    public List<Map<String,Object>> conversations(){
        ready();return db.list("SELECT peer_key,MAX(message_at) AS last_message_at,COUNT(*) AS message_count FROM kf_messages WHERE account_key=? AND peer_key IS NOT NULL AND message_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY) GROUP BY peer_key ORDER BY last_message_at DESC LIMIT 300",client.accountKey(),client.retentionDays());
    }
    public List<Map<String,Object>> messages(String peer){
        ready();Db.badIf(peer==null||!peer.matches("[a-f0-9]{64}"),"会话标识无效");
        return db.list("SELECT id,origin,message_type,content,message_at,recalled FROM kf_messages WHERE account_key=? AND peer_key=? AND message_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY) ORDER BY message_at DESC,id DESC LIMIT 200",client.accountKey(),peer,client.retentionDays());
    }
    @Scheduled(cron="0 40 3 * * *",zone="Asia/Shanghai")
    public void purge(){int days=client.retentionDays();if(days>=1&&days<=90)db.execute("DELETE FROM kf_messages WHERE message_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY)",days);}
}
