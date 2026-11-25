package com.socialtask.sla;

import com.socialtask.common.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;

@Service
public class SlaService {
    private final Db db;private final Audit audit;
    public SlaService(Db db,Audit audit){this.db=db;this.audit=audit;}
    public record PolicyInput(String name,String taskType,String priority,Integer responseMinutes,Integer resolutionMinutes,
                              String calendarMode,String timezone,String businessStart,String businessEnd,String workingDays,Boolean enabled,Integer responseWarningMinutes,Integer resolutionWarningMinutes) {}
    private static final Set<String> TYPES=Set.of("ALL","PUBLISH","OFFICIAL_COMMENT","CONTACT_AUTHOR","CONTACT_ASSISTANT","FOLLOWUP","SERVICE_TICKET");
    private static final Set<String> PRIORITIES=Set.of("NORMAL","HIGH","URGENT");
    private static Map<String,Object> validate(PolicyInput in) {
        String type=in.taskType()==null?"ALL":in.taskType();String pr=in.priority()==null?"NORMAL":in.priority();
        if(!TYPES.contains(type)||!PRIORITIES.contains(pr)) throw new ApiException(400,"SLA 工单类型或优先级不合法");
        int response=in.responseMinutes()==null?120:in.responseMinutes();int resolution=in.resolutionMinutes()==null?1440:in.resolutionMinutes();
        if(response<1||resolution<1||response>525600||resolution>525600||response>resolution) throw new ApiException(400,"首次响应须小于等于解决时限，范围 1 至 525600 分钟");
        String mode=in.calendarMode()==null?"24X7":in.calendarMode();String zone=in.timezone()==null?"Asia/Shanghai":in.timezone();
        String start=in.businessStart()==null?"09:00":in.businessStart();String end=in.businessEnd()==null?"18:00":in.businessEnd();
        String days=in.workingDays()==null?"1,2,3,4,5":in.workingDays();
        try{SlaClock.deadline(Instant.now(),response,mode,zone,start,end,days);}catch(RuntimeException e){throw new ApiException(400,"SLA 日历设置错误："+e.getMessage());}
        int responseWarning=in.responseWarningMinutes()==null?Math.min(response,30):in.responseWarningMinutes();
        int resolutionWarning=in.resolutionWarningMinutes()==null?Math.min(resolution,60):in.resolutionWarningMinutes();
        if(responseWarning<0||resolutionWarning<0||responseWarning>response||resolutionWarning>resolution) throw new ApiException(400,"SLA 预警分钟数必须在 0 至目标时长之间");
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("name",Db.required(in.name(),"策略名称",120));result.put("task_type",type);result.put("priority",pr);
        result.put("response_minutes",response);result.put("resolution_minutes",resolution);result.put("response_warning_minutes",responseWarning);result.put("resolution_warning_minutes",resolutionWarning);
        result.put("calendar_mode",mode);result.put("timezone",zone);result.put("business_start",start);result.put("business_end",end);
        result.put("working_days",days);result.put("enabled",in.enabled()==null?true:in.enabled());return result;
    }
    public List<Map<String,Object>> policies(){Access.admin();return db.list("SELECT * FROM sla_policies ORDER BY task_type,priority,id");}
    @Transactional public Map<String,Object> create(PolicyInput input){
        var who=Access.admin();var p=validate(input);
        long id=db.insert("INSERT INTO sla_policies(name,task_type,priority,response_minutes,resolution_minutes,calendar_mode,timezone,business_start,business_end,working_days,enabled,response_warning_minutes,resolution_warning_minutes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            p.get("name"),p.get("task_type"),p.get("priority"),p.get("response_minutes"),p.get("resolution_minutes"),p.get("calendar_mode"),p.get("timezone"),p.get("business_start"),p.get("business_end"),p.get("working_days"),p.get("enabled"),p.get("response_warning_minutes"),p.get("resolution_warning_minutes"));
        audit.record(who.id(),"sla_policy",id,"CREATE",p);return db.one("SELECT * FROM sla_policies WHERE id=?",id);
    }
    @Transactional public Map<String,Object> update(long id,PolicyInput input){
        var who=Access.admin();db.one("SELECT id FROM sla_policies WHERE id=? FOR UPDATE",id);var p=validate(input);
        db.execute("UPDATE sla_policies SET name=?,task_type=?,priority=?,response_minutes=?,resolution_minutes=?,calendar_mode=?,timezone=?,business_start=?,business_end=?,working_days=?,enabled=?,response_warning_minutes=?,resolution_warning_minutes=? WHERE id=?",
            p.get("name"),p.get("task_type"),p.get("priority"),p.get("response_minutes"),p.get("resolution_minutes"),p.get("calendar_mode"),p.get("timezone"),p.get("business_start"),p.get("business_end"),p.get("working_days"),p.get("enabled"),p.get("response_warning_minutes"),p.get("resolution_warning_minutes"),id);
        audit.record(who.id(),"sla_policy",id,"UPDATE",p);return db.one("SELECT * FROM sla_policies WHERE id=?",id);
    }
    private Map<String,Object> policy(String type,String priority){
        var policy=db.optional("SELECT * FROM sla_policies WHERE enabled=TRUE AND priority=? AND task_type IN (?, 'ALL') ORDER BY CASE WHEN task_type=? THEN 0 ELSE 1 END LIMIT 1",priority,type,type);
        if(policy==null) throw new ApiException(409,"没有匹配的 SLA 策略（类型="+type+"，优先级="+priority+"）");
        return policy;
    }
    private Instant due(Instant start,Map<String,Object> p,String unit){
        return SlaClock.deadline(start,Db.n(p.get(unit+"_minutes")),Db.str(p.get("calendar_mode")),Db.str(p.get("timezone")),Db.str(p.get("business_start")),Db.str(p.get("business_end")),Db.str(p.get("working_days")));
    }
    public void attach(long taskId,String type,String priority,Instant startedAt){
        var p=policy(type,priority);
        db.execute("INSERT INTO task_sla(task_id,policy_id,response_due_at,resolution_due_at) VALUES(?,?,?,?)",
            taskId,Db.id(p),Db.stamp(due(startedAt,p,"response")),Db.stamp(due(startedAt,p,"resolution")));
    }
    @Transactional public Map<String,Object> reprioritize(long taskId,String priority){
        var actor=Access.admin();if(!PRIORITIES.contains(priority)) throw new ApiException(400,"优先级不合法");
        var t=db.one("SELECT id,type,status,created_at,priority FROM tasks WHERE id=? FOR UPDATE",taskId);
        Db.ensure("PENDING".equals(t.get("status")),"仅尚未提交的待处理工单允许改变优先级及 SLA 快照");
        var snapshot=db.one("SELECT first_response_at,response_breached_at,resolution_breached_at FROM task_sla WHERE task_id=? FOR UPDATE",taskId);
        Db.ensure(snapshot.get("first_response_at")==null&&snapshot.get("response_breached_at")==null&&snapshot.get("resolution_breached_at")==null,"已有响应或违约记录不可重置 SLA，须通过审计建立新工单");
        var p=policy(Db.str(t.get("type")),priority);var created=Db.instant(t.get("created_at"));
        db.execute("UPDATE task_sla SET policy_id=?,response_due_at=?,resolution_due_at=?,response_breached_at=NULL,resolution_breached_at=NULL WHERE task_id=?",
            Db.id(p),Db.stamp(due(created,p,"response")),Db.stamp(due(created,p,"resolution")),taskId);
        db.execute("UPDATE tasks SET priority=? WHERE id=?",priority,taskId);
        audit.record(actor.id(),"task",taskId,"PRIORITY_CHANGE",Map.of("from",t.get("priority"),"to",priority));
        return db.one("SELECT * FROM task_sla WHERE task_id=?",taskId);
    }
    /** The first worker submission (even if later rejected) is the first response. */
    public void markResponded(long taskId){
        db.execute("UPDATE task_sla SET response_breached_at=CASE WHEN first_response_at IS NULL AND UTC_TIMESTAMP(3)>response_due_at THEN COALESCE(response_breached_at,UTC_TIMESTAMP(3)) ELSE response_breached_at END,first_response_at=COALESCE(first_response_at,UTC_TIMESTAMP(3)) WHERE task_id=?",taskId);
    }
    public void markResolved(long taskId){
        db.execute("UPDATE task_sla SET resolved_at=COALESCE(resolved_at,UTC_TIMESTAMP(3)),resolution_breached_at=CASE WHEN resolution_breached_at IS NULL AND UTC_TIMESTAMP(3)>resolution_due_at THEN UTC_TIMESTAMP(3) ELSE resolution_breached_at END WHERE task_id=?",taskId);
    }
    /** Persist both SLA breach flags and one admin-workbench escalation for each type. */
    @Scheduled(fixedDelayString="60000",initialDelayString="22000") public void schedule(){if(schedulerEnabled)tick();}
    @org.springframework.beans.factory.annotation.Value("${app.scheduler.enabled:true}") private boolean schedulerEnabled;
    @Transactional public Map<String,Integer> tick(){
        int response=0,resolution=0,warnings=0;
        var rows=db.list("SELECT s.*,t.status,t.assignee_id,p.response_warning_minutes,p.resolution_warning_minutes FROM task_sla s JOIN tasks t ON t.id=s.task_id JOIN sla_policies p ON p.id=s.policy_id WHERE t.status NOT IN ('CANCELLED','STOPPED','COMPLETED') AND ("
          +"(s.first_response_at IS NULL AND (s.response_breached_at IS NULL AND s.response_due_at<UTC_TIMESTAMP(3) OR s.response_warned_at IS NULL AND p.response_warning_minutes>0 AND s.response_due_at BETWEEN UTC_TIMESTAMP(3) AND DATE_ADD(UTC_TIMESTAMP(3),INTERVAL p.response_warning_minutes MINUTE))) OR "
          +"(s.resolved_at IS NULL AND (s.resolution_breached_at IS NULL AND s.resolution_due_at<UTC_TIMESTAMP(3) OR s.resolution_warned_at IS NULL AND p.resolution_warning_minutes>0 AND s.resolution_due_at BETWEEN UTC_TIMESTAMP(3) AND DATE_ADD(UTC_TIMESTAMP(3),INTERVAL p.resolution_warning_minutes MINUTE)))) "
          +"ORDER BY s.task_id LIMIT 200 FOR UPDATE SKIP LOCKED");
        for(var row:rows){long id=Db.l(row.get("task_id"));
            Instant now=Instant.now();
            if(row.get("first_response_at")==null&&row.get("response_warned_at")==null&&Db.n(row.get("response_warning_minutes"))>0&&Db.instant(row.get("response_due_at")).isAfter(now)&&!Db.instant(row.get("response_due_at")).isAfter(now.plus(Duration.ofMinutes(Db.n(row.get("response_warning_minutes")))))){
                db.execute("UPDATE task_sla SET response_warned_at=UTC_TIMESTAMP(3) WHERE task_id=?",id);
                db.execute("INSERT INTO notifications(event_key,task_id,person_id,event_type,state,details) VALUES(?, ?,NULL,'SLA_RESPONSE_WARNING','WORKBENCH',?) ON DUPLICATE KEY UPDATE id=id",
                    "TASK:"+id+":SLA:RESPONSE:WARN",id,"首次响应 SLA 即将到期，请关注执行进度");warnings++;
            }
            if(row.get("resolved_at")==null&&row.get("resolution_warned_at")==null&&Db.n(row.get("resolution_warning_minutes"))>0&&Db.instant(row.get("resolution_due_at")).isAfter(now)&&!Db.instant(row.get("resolution_due_at")).isAfter(now.plus(Duration.ofMinutes(Db.n(row.get("resolution_warning_minutes")))))){
                db.execute("UPDATE task_sla SET resolution_warned_at=UTC_TIMESTAMP(3) WHERE task_id=?",id);
                db.execute("INSERT INTO notifications(event_key,task_id,person_id,event_type,state,details) VALUES(?, ?,NULL,'SLA_RESOLUTION_WARNING','WORKBENCH',?) ON DUPLICATE KEY UPDATE id=id",
                    "TASK:"+id+":SLA:RESOLUTION:WARN",id,"解决 SLA 即将到期，请关注处理进度");warnings++;
            }
            if(row.get("first_response_at")==null&&row.get("response_breached_at")==null&&Db.instant(row.get("response_due_at")).isBefore(Instant.now())){
                db.execute("UPDATE task_sla SET response_breached_at=UTC_TIMESTAMP(3) WHERE task_id=?",id);
                db.execute("INSERT INTO notifications(event_key,task_id,person_id,event_type,state,details) VALUES(?, ?,NULL,'SLA_RESPONSE_BREACH','WORKBENCH',?) ON DUPLICATE KEY UPDATE id=id",
                    "TASK:"+id+":SLA:RESPONSE",id,"工单首次响应超过 SLA，请检查处理人及任务状态");response++;
            }
            if(row.get("resolved_at")==null&&row.get("resolution_breached_at")==null&&Db.instant(row.get("resolution_due_at")).isBefore(Instant.now())){
                db.execute("UPDATE task_sla SET resolution_breached_at=UTC_TIMESTAMP(3) WHERE task_id=?",id);
                db.execute("INSERT INTO notifications(event_key,task_id,person_id,event_type,state,details) VALUES(?, ?,NULL,'SLA_RESOLUTION_BREACH','WORKBENCH',?) ON DUPLICATE KEY UPDATE id=id",
                    "TASK:"+id+":SLA:RESOLUTION",id,"工单解决时间超过 SLA，请管理员升级或转派");resolution++;
            }
        }
        return Map.of("response_breaches",response,"resolution_breaches",resolution,"warnings",warnings);
    }
    public Map<String,Object> view(long taskId){
        Access.admin();return db.one("SELECT s.*,p.name AS policy_name,p.calendar_mode,p.timezone,p.response_minutes,p.resolution_minutes FROM task_sla s JOIN sla_policies p ON p.id=s.policy_id WHERE s.task_id=?",taskId);
    }
}
