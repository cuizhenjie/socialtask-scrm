package com.socialtask.notification;

import com.socialtask.common.*;
import com.socialtask.task.TaskService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;

@Service
public class SchedulerService {
    private final Db db;private final TaskService tasks;private final Audit audit;
    @Value("${app.scheduler.enabled:true}") private boolean enabled;
    @Value("${app.followup.max-active-tasks:10}") private int maxActiveTasks;
    public SchedulerService(Db db,TaskService tasks,Audit audit){this.db=db;this.tasks=tasks;this.audit=audit;}
    @Scheduled(fixedDelayString="60000",initialDelayString="12000") public void dueJob(){if(enabled){remindDue();createFollowups();}}
    @Transactional public Map<String,Object> remindDue() {
        int reminded=0,overdue=0;
        List<Map<String,Object>> waiting=db.list("SELECT * FROM tasks WHERE status IN ('PENDING','REWORK') AND (next_remind_at<=UTC_TIMESTAMP(3) OR due_at<UTC_TIMESTAMP(3)) ORDER BY due_at LIMIT 100 FOR UPDATE SKIP LOCKED");
        Instant now=Instant.now();
        for(var t:waiting){
            long id=Db.id(t);String state=Db.str(t.get("status"));int count=Db.n(t.get("reminder_count")),max=Db.n(t.get("reminder_max"));
            if(Db.instant(t.get("due_at")).isBefore(now) && t.get("overdue_at")==null){
                db.execute("UPDATE tasks SET overdue_at=? WHERE id=?",Db.stamp(now),id);overdue++;
                tasks.notifyTask(id,Db.l(t.get("assignee_id")),"TASK_OVERDUE","任务已超时","TASK:"+id+":OVERDUE");
            }
            if(t.get("next_remind_at")==null || Db.instant(t.get("next_remind_at")).isAfter(now)) continue;
            if(Rules.mayRemind(state,count,max)){
                int next=count+1;
                boolean atLimit=next>=max;
                db.execute("UPDATE tasks SET reminder_count=?,next_remind_at=? WHERE id=?",next,
                    atLimit?null:Db.stamp(now.plus(Duration.ofMinutes(Db.n(t.get("reminder_interval"))))),id);
                tasks.notifyTask(id,Db.l(t.get("assignee_id")),"TASK_REMINDER","第"+next+"次催办，请打开任务处理","TASK:"+id+":REMIND:"+next);
                if(atLimit) {
                    db.execute("INSERT INTO notifications(event_key,task_id,person_id,event_type,details,state) VALUES(?, ?,NULL,'ADMIN_ESCALATION',?,'WORKBENCH') ON DUPLICATE KEY UPDATE id=id",
                        "TASK:"+id+":LIMIT",id,"任务已达到催办上限，需要管理员人工处理");
                }
                reminded++;
            }
        }
        return Map.of("reminded",reminded,"new_overdue",overdue);
    }
    @Transactional public Map<String,Object> createFollowups() {
        // Unique(customer_id,round_no) + customer row FOR UPDATE prevents duplicate follow-up under concurrent ticks.
        int created=0,noStaff=0;
        var rounds=db.list("SELECT r.id AS round_id,r.customer_id,c.status,c.contact_allowed,c.do_not_contact,c.consent_basis FROM contact_rounds r JOIN customers c ON c.id=r.customer_id WHERE r.round_no=1 AND r.status='ACTIVE' AND c.status IN ('NEW','NO_REPLY') AND c.contact_allowed=TRUE AND c.do_not_contact=FALSE ORDER BY r.id LIMIT 200");
        for(var row:rounds) {
            long customerId=Db.l(row.get("customer_id"));
            var c=db.one("SELECT * FROM customers WHERE id=? FOR UPDATE",customerId);
            if(!Db.bool(c.get("contact_allowed")) || Db.bool(c.get("do_not_contact")) || Set.of("RESPONDED","REFUSED").contains(Db.str(c.get("status")))) continue;
            if(db.optional("SELECT id FROM contact_rounds WHERE customer_id=? AND round_no=2",customerId)!=null) continue;
            var attempts=db.list("SELECT t.type,t.status,t.updated_at,a.reply_status FROM tasks t LEFT JOIN contact_attempts a ON a.task_id=t.id WHERE t.round_id=? AND t.type IN ('CONTACT_AUTHOR','CONTACT_ASSISTANT')",row.get("round_id"));
            if(attempts.size()!=2 || attempts.stream().anyMatch(a->!"COMPLETED".equals(a.get("status")))) continue;
            String author=null,assistant=null;Instant finished=null;
            for(var a:attempts){
                if("CONTACT_AUTHOR".equals(a.get("type"))) author=Db.str(a.get("reply_status"));
                if("CONTACT_ASSISTANT".equals(a.get("type"))) assistant=Db.str(a.get("reply_status"));
                Instant at=Db.instant(a.get("updated_at"));if(finished==null || at.isAfter(finished)) finished=at;
            }
            if(!Rules.mayFollowup(author,assistant,"NO_REPLY",true,false,finished,Instant.now())) continue;
            var staff=db.optional("SELECT p.id FROM people p LEFT JOIN tasks t ON t.assignee_id=p.id AND t.status IN ('PENDING','REWORK') "
                + "WHERE p.person_type='support' AND p.group_name='第三组' AND p.status='ACTIVE' "
                + "AND p.wecom_userid IS NOT NULL AND p.wecom_userid<>'' "
                + "AND EXISTS(SELECT 1 FROM social_accounts sa WHERE sa.person_id=p.id AND sa.platform='douyin' AND sa.status='ACTIVE') "
                + "GROUP BY p.id HAVING COUNT(t.id) < ? ORDER BY COUNT(t.id) ASC,p.id ASC LIMIT 1",Math.max(1,maxActiveTasks));
            if(staff==null){noStaff++;continue;}
            long round=db.insert("INSERT INTO contact_rounds(customer_id,round_no) VALUES(?,2)",customerId);
            long task=tasks.newTask("FOLLOWUP","次日授权客服回访",Db.id(staff),Instant.now().plus(Duration.ofHours(12)),null,null,customerId,round,
                Map.of("private_message","您好，这里是官方客服。您此前咨询过相关项目，如仍需要了解，可以由我为您答疑；如不需要，我们将不再打扰。","disclose_identity",true),60,3,null);
            db.execute("UPDATE customers SET status='FOLLOWUP_PENDING' WHERE id=?",customerId);
            audit.record(null,"contact_round",round,"AUTO_FOLLOWUP",Map.of("task_id",task));
            created++;
        }
        return Map.of("created",created,"missing_support",noStaff);
    }
}
