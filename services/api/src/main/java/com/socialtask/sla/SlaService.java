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
                              String calendarMode,String timezone,String businessStart,String businessEnd,String workingDays,Boolean enabled,Integer responseWarningMinutes,Integer resolutionWarningMinutes,
                              String closedDates,String openDates,String escalationMinutes) {}
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
        String closed=in.closedDates()==null?"":in.closedDates(),opened=in.openDates()==null?"":in.openDates(),escalations=in.escalationMinutes()==null?"":in.escalationMinutes();
        try{
            SlaClock.deadline(Instant.now(),response,mode,zone,start,end,days,closed,opened);
            closed=String.join(",",SlaClock.parseDates(closed).stream().map(Object::toString).toList());
            opened=String.join(",",SlaClock.parseDates(opened).stream().map(Object::toString).toList());
            escalations=String.join(",",SlaClock.escalationSteps(escalations).stream().map(Object::toString).toList());
        }catch(RuntimeException e){throw new ApiException(400,"SLA 日历或升级配置错误："+e.getMessage());}
        int responseWarning=in.responseWarningMinutes()==null?Math.min(response,30):in.responseWarningMinutes();
        int resolutionWarning=in.resolutionWarningMinutes()==null?Math.min(resolution,60):in.resolutionWarningMinutes();
        if(responseWarning<0||resolutionWarning<0||responseWarning>response||resolutionWarning>resolution) throw new ApiException(400,"SLA 预警分钟数必须在 0 至目标时长之间");
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("name",Db.required(in.name(),"策略名称",120));result.put("task_type",type);result.put("priority",pr);
        result.put("response_minutes",response);result.put("resolution_minutes",resolution);result.put("response_warning_minutes",responseWarning);result.put("resolution_warning_minutes",resolutionWarning);
        result.put("calendar_mode",mode);result.put("timezone",zone);result.put("business_start",start);result.put("business_end",end);
        result.put("working_days",days);result.put("closed_dates",closed);result.put("open_dates",opened);result.put("escalation_minutes",escalations);result.put("enabled",in.enabled()==null?true:in.enabled());return result;
    }
    public List<Map<String,Object>> policies(){Access.admin();return db.list("SELECT * FROM sla_policies ORDER BY task_type,priority,id");}
    @Transactional public Map<String,Object> create(PolicyInput input){
        var who=Access.admin();var p=validate(input);
        long id=db.insert("INSERT INTO sla_policies(name,task_type,priority,response_minutes,resolution_minutes,calendar_mode,timezone,business_start,business_end,working_days,enabled,response_warning_minutes,resolution_warning_minutes,closed_dates,open_dates,escalation_minutes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            p.get("name"),p.get("task_type"),p.get("priority"),p.get("response_minutes"),p.get("resolution_minutes"),p.get("calendar_mode"),p.get("timezone"),p.get("business_start"),p.get("business_end"),p.get("working_days"),p.get("enabled"),p.get("response_warning_minutes"),p.get("resolution_warning_minutes"),p.get("closed_dates"),p.get("open_dates"),p.get("escalation_minutes"));
        audit.record(who.id(),"sla_policy",id,"CREATE",p);return db.one("SELECT * FROM sla_policies WHERE id=?",id);
    }
    @Transactional public Map<String,Object> update(long id,PolicyInput input){
        var who=Access.admin();db.one("SELECT id FROM sla_policies WHERE id=? FOR UPDATE",id);var p=validate(input);
        db.execute("UPDATE sla_policies SET name=?,task_type=?,priority=?,response_minutes=?,resolution_minutes=?,calendar_mode=?,timezone=?,business_start=?,business_end=?,working_days=?,enabled=?,response_warning_minutes=?,resolution_warning_minutes=?,closed_dates=?,open_dates=?,escalation_minutes=? WHERE id=?",
            p.get("name"),p.get("task_type"),p.get("priority"),p.get("response_minutes"),p.get("resolution_minutes"),p.get("calendar_mode"),p.get("timezone"),p.get("business_start"),p.get("business_end"),p.get("working_days"),p.get("enabled"),p.get("response_warning_minutes"),p.get("resolution_warning_minutes"),p.get("closed_dates"),p.get("open_dates"),p.get("escalation_minutes"),id);
        audit.record(who.id(),"sla_policy",id,"UPDATE",p);return db.one("SELECT * FROM sla_policies WHERE id=?",id);
    }
    private Map<String,Object> policy(String type,String priority){
        var policy=db.optional("SELECT * FROM sla_policies WHERE enabled=TRUE AND priority=? AND task_type IN (?, 'ALL') ORDER BY CASE WHEN task_type=? THEN 0 ELSE 1 END LIMIT 1",priority,type,type);
        if(policy==null) throw new ApiException(409,"没有匹配的 SLA 策略（类型="+type+"，优先级="+priority+"）");
        return policy;
    }
    private static final List<String> CALENDAR_KEYS=List.of("calendar_mode","timezone","business_start","business_end","working_days","closed_dates","open_dates");
    private static SlaClock.CalendarSpec calendar(Map<String,Object> p){
        return SlaClock.calendar(Db.str(p.get("calendar_mode")),Db.str(p.get("timezone")),Db.str(p.get("business_start")),Db.str(p.get("business_end")),Db.str(p.get("working_days")),Objects.toString(p.get("closed_dates"),""),Objects.toString(p.get("open_dates"),""));
    }
    private String calendarSnapshot(Map<String,Object> p){
        Map<String,Object> copy=new LinkedHashMap<>();for(String key:CALENDAR_KEYS)copy.put(key,Objects.toString(p.get(key),""));return db.json(copy);
    }
    private Instant due(Instant start,Map<String,Object> p,String unit){return calendar(p).addMillis(start,Duration.ofMinutes(Db.n(p.get(unit+"_minutes"))).toMillis());}
    public void attach(long taskId,String type,String priority,Instant startedAt){
        var p=policy(type,priority);
        db.execute("INSERT INTO task_sla(task_id,policy_id,response_due_at,resolution_due_at,calendar_snapshot,response_warning_minutes,resolution_warning_minutes,escalation_minutes) VALUES(?,?,?,?,?,?,?,?)",
            taskId,Db.id(p),Db.stamp(due(startedAt,p,"response")),Db.stamp(due(startedAt,p,"resolution")),calendarSnapshot(p),p.get("response_warning_minutes"),p.get("resolution_warning_minutes"),p.get("escalation_minutes"));
    }
    @Transactional public Map<String,Object> reprioritize(long taskId,String priority){
        var actor=Access.admin();if(!PRIORITIES.contains(priority)) throw new ApiException(400,"优先级不合法");
        var t=db.one("SELECT id,type,status,created_at,priority FROM tasks WHERE id=? FOR UPDATE",taskId);
        Db.ensure("PENDING".equals(t.get("status")),"仅尚未提交的待处理工单允许改变优先级及 SLA 快照");
        var snapshot=db.one("SELECT * FROM task_sla WHERE task_id=? FOR UPDATE",taskId);
        Db.ensure(snapshot.get("first_response_at")==null&&snapshot.get("response_breached_at")==null&&snapshot.get("resolution_breached_at")==null&&Db.n(snapshot.get("pause_count"))==0&&Db.instant(snapshot.get("response_due_at")).isAfter(Instant.now())&&Db.instant(snapshot.get("resolution_due_at")).isAfter(Instant.now()),"已有响应、暂停或违约不可重置 SLA，须通过审计建立新工单");
        var p=policy(Db.str(t.get("type")),priority);var created=Db.instant(t.get("created_at"));
        db.execute("UPDATE task_sla SET policy_id=?,response_due_at=?,resolution_due_at=?,calendar_snapshot=?,response_warning_minutes=?,resolution_warning_minutes=?,escalation_minutes=?,response_breached_at=NULL,resolution_breached_at=NULL,response_warned_at=NULL,resolution_warned_at=NULL WHERE task_id=?",
            Db.id(p),Db.stamp(due(created,p,"response")),Db.stamp(due(created,p,"resolution")),calendarSnapshot(p),p.get("response_warning_minutes"),p.get("resolution_warning_minutes"),p.get("escalation_minutes"),taskId);
        db.execute("UPDATE tasks SET priority=? WHERE id=?",priority,taskId);
        audit.record(actor.id(),"task",taskId,"PRIORITY_CHANGE",Map.of("from",t.get("priority"),"to",priority));
        return db.one("SELECT * FROM task_sla WHERE task_id=?",taskId);
    }
    private static boolean active(Object status){return Set.of("PENDING","REWORK","SUBMITTED","PAUSED").contains(status);}
    private Long remaining(Map<String,Object> s,String unit,String finished,Instant now,SlaClock.CalendarSpec calendar){
        if(s.get(finished)!=null)return null;
        Instant due=Db.instant(s.get(unit+"_due_at"));
        Db.ensure(due.isAfter(now),"已到期的 SLA 不允许暂停");
        long budget=calendar.workingMillis(now,due);Db.ensure(budget>0,"SLA 无可暂停的剩余工作时间");return budget;
    }
    @Transactional public Map<String,Object> pause(long taskId,String reason){
        var actor=Access.admin();String why=Db.required(reason,"暂停原因",300);
        var t=db.one("SELECT id,status FROM tasks WHERE id=? FOR UPDATE",taskId);Db.ensure(active(t.get("status")),"只有进行中的工单可以暂停 SLA");
        var row=db.one("SELECT * FROM task_sla WHERE task_id=? FOR UPDATE",taskId);
        Db.ensure(row.get("paused_at")==null&&row.get("resolved_at")==null,"SLA 已暂停或已解决");
        Db.ensure(row.get("response_breached_at")==null&&row.get("resolution_breached_at")==null,"已有违约记录的工单不得暂停以隐藏违约");
        Instant now=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        var spec=calendar(db.object(row.get("calendar_snapshot")));
        Long response=remaining(row,"response","first_response_at",now,spec),resolution=remaining(row,"resolution","resolved_at",now,spec);
        db.execute("UPDATE task_sla SET paused_at=?,pause_reason=?,response_remaining_ms=?,resolution_remaining_ms=?,pause_count=pause_count+1 WHERE task_id=?",Db.stamp(now),why,response,resolution,taskId);
        audit.record(actor.id(),"task",taskId,"SLA_PAUSE",Map.of("reason",why));
        return db.one("SELECT * FROM task_sla WHERE task_id=?",taskId);
    }
    @Transactional public Map<String,Object> resume(long taskId){
        var actor=Access.admin();var t=db.one("SELECT id,status FROM tasks WHERE id=? FOR UPDATE",taskId);Db.ensure(active(t.get("status")),"只有进行中的工单可以恢复 SLA");
        var row=db.one("SELECT * FROM task_sla WHERE task_id=? FOR UPDATE",taskId);
        Db.ensure(row.get("paused_at")!=null,"SLA 当前未暂停");
        var spec=calendar(db.object(row.get("calendar_snapshot")));Instant now=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        Instant response=row.get("response_remaining_ms")==null?Db.instant(row.get("response_due_at")):spec.addMillis(now,Db.l(row.get("response_remaining_ms")));
        Instant resolution=row.get("resolution_remaining_ms")==null?Db.instant(row.get("resolution_due_at")):spec.addMillis(now,Db.l(row.get("resolution_remaining_ms")));
        long elapsed=Math.max(0,Duration.between(Db.instant(row.get("paused_at")),now).toMillis());
        db.execute("UPDATE task_sla SET response_due_at=?,resolution_due_at=?,paused_at=NULL,pause_reason=NULL,response_remaining_ms=NULL,resolution_remaining_ms=NULL,paused_total_ms=paused_total_ms+? WHERE task_id=?",Db.stamp(response),Db.stamp(resolution),elapsed,taskId);
        audit.record(actor.id(),"task",taskId,"SLA_RESUME",Map.of("paused_wall_ms",elapsed));
        return db.one("SELECT * FROM task_sla WHERE task_id=?",taskId);
    }
    /** The caller holds the task row lock. Pause and completion cannot race. */
    public void requireRunning(long taskId){
        var row=db.optional("SELECT paused_at FROM task_sla WHERE task_id=? FOR UPDATE",taskId);
        Db.ensure(row==null||row.get("paused_at")==null,"SLA 已暂停，请管理员恢复后再提交或审核");
    }
    /** The first worker submission (even if later rejected) is the first response. */
    public void markResponded(long taskId){
        db.execute("UPDATE task_sla SET response_breached_at=CASE WHEN first_response_at IS NULL AND UTC_TIMESTAMP(3)>response_due_at THEN COALESCE(response_breached_at,UTC_TIMESTAMP(3)) ELSE response_breached_at END,first_response_at=COALESCE(first_response_at,UTC_TIMESTAMP(3)),next_response_escalation_at=NULL WHERE task_id=?",taskId);
    }
    public void markResolved(long taskId){
        db.execute("UPDATE task_sla SET resolved_at=COALESCE(resolved_at,UTC_TIMESTAMP(3)),resolution_breached_at=CASE WHEN resolution_breached_at IS NULL AND UTC_TIMESTAMP(3)>resolution_due_at THEN UTC_TIMESTAMP(3) ELSE resolution_breached_at END,next_resolution_escalation_at=NULL WHERE task_id=?",taskId);
    }
    /** Persist both SLA breach flags and one admin-workbench escalation for each type. */
    @Scheduled(fixedDelayString="60000",initialDelayString="22000") @Transactional public void schedule(){if(schedulerEnabled)tick();}
    @org.springframework.beans.factory.annotation.Value("${app.scheduler.enabled:true}") private boolean schedulerEnabled;
    @Transactional public Map<String,Integer> tick(){
        int response=0,resolution=0,warnings=0;
        var rows=db.list("SELECT s.*,t.status,t.assignee_id FROM task_sla s JOIN tasks t ON t.id=s.task_id WHERE s.paused_at IS NULL AND t.status NOT IN ('CANCELLED','STOPPED','COMPLETED') AND ("
          +"(s.first_response_at IS NULL AND (s.response_breached_at IS NULL AND s.response_due_at<UTC_TIMESTAMP(3) OR s.response_warned_at IS NULL AND s.response_warning_minutes>0 AND s.response_due_at BETWEEN UTC_TIMESTAMP(3) AND DATE_ADD(UTC_TIMESTAMP(3),INTERVAL s.response_warning_minutes MINUTE))) OR "
          +"(s.resolved_at IS NULL AND (s.resolution_breached_at IS NULL AND s.resolution_due_at<UTC_TIMESTAMP(3) OR s.resolution_warned_at IS NULL AND s.resolution_warning_minutes>0 AND s.resolution_due_at BETWEEN UTC_TIMESTAMP(3) AND DATE_ADD(UTC_TIMESTAMP(3),INTERVAL s.resolution_warning_minutes MINUTE)))) "
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
                db.execute("UPDATE task_sla SET response_breached_at=UTC_TIMESTAMP(3),next_response_escalation_at=? WHERE task_id=?",nextEscalation(row,"response",0),id);
                db.execute("INSERT INTO notifications(event_key,task_id,person_id,event_type,state,details) VALUES(?, ?,NULL,'SLA_RESPONSE_BREACH','WORKBENCH',?) ON DUPLICATE KEY UPDATE id=id",
                    "TASK:"+id+":SLA:RESPONSE",id,"工单首次响应超过 SLA，请检查处理人及任务状态");response++;
            }
            if(row.get("resolved_at")==null&&row.get("resolution_breached_at")==null&&Db.instant(row.get("resolution_due_at")).isBefore(Instant.now())){
                db.execute("UPDATE task_sla SET resolution_breached_at=UTC_TIMESTAMP(3),next_resolution_escalation_at=? WHERE task_id=?",nextEscalation(row,"resolution",0),id);
                db.execute("INSERT INTO notifications(event_key,task_id,person_id,event_type,state,details) VALUES(?, ?,NULL,'SLA_RESOLUTION_BREACH','WORKBENCH',?) ON DUPLICATE KEY UPDATE id=id",
                    "TASK:"+id+":SLA:RESOLUTION",id,"工单解决时间超过 SLA，请管理员升级或转派");resolution++;
            }
        }
        int escalations=escalate();
        return Map.of("response_breaches",response,"resolution_breaches",resolution,"warnings",warnings,"escalations",escalations);
    }
    private Object nextEscalation(Map<String,Object> row,String unit,int level){
        var steps=SlaClock.escalationSteps(Db.str(row.get("escalation_minutes")));
        return level>=steps.size()?null:Db.stamp(Db.instant(row.get(unit+"_due_at")).plus(Duration.ofMinutes(steps.get(level))));
    }
    private int escalate(){
        int count=0;Instant now=Instant.now();
        var rows=db.list("SELECT s.* FROM task_sla s JOIN tasks t ON t.id=s.task_id WHERE s.paused_at IS NULL AND t.status NOT IN ('CANCELLED','STOPPED','COMPLETED') AND ((s.first_response_at IS NULL AND s.next_response_escalation_at<=UTC_TIMESTAMP(3)) OR (s.resolved_at IS NULL AND s.next_resolution_escalation_at<=UTC_TIMESTAMP(3))) ORDER BY s.task_id LIMIT 200 FOR UPDATE SKIP LOCKED");
        for(var row:rows){
            long id=Db.l(row.get("task_id"));
            for(String unit:List.of("response","resolution")){
                String finished=unit.equals("response")?"first_response_at":"resolved_at",next="next_"+unit+"_escalation_at",levelKey=unit+"_escalation_level";
                if(row.get(finished)!=null||row.get(next)==null||Db.instant(row.get(next)).isAfter(now))continue;
                int level=Db.n(row.get(levelKey))+1;
                db.execute("UPDATE task_sla SET "+levelKey+"=?,"+next+"=? WHERE task_id=?",level,nextEscalation(row,unit,level),id);
                String stage=unit.toUpperCase(Locale.ROOT);
                db.execute("INSERT INTO notifications(event_key,task_id,person_id,event_type,state,details) VALUES(?,?,NULL,?,'WORKBENCH',?) ON DUPLICATE KEY UPDATE id=id",
                    "TASK:"+id+":SLA:"+stage+":LEVEL:"+level,id,"SLA_"+stage+"_ESCALATION",(unit.equals("response")?"首次响应":"解决")+" SLA 第 "+level+" 级升级，请管理人员人工处理");
                count++;
            }
        }
        return count;
    }
    public Map<String,Object> view(long taskId){
        Access.admin();return db.one("SELECT s.*,p.name AS policy_name,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.calendar_snapshot,'$.calendar_mode')),p.calendar_mode) AS calendar_mode,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.calendar_snapshot,'$.timezone')),p.timezone) AS timezone FROM task_sla s JOIN sla_policies p ON p.id=s.policy_id WHERE s.task_id=?",taskId);
    }
}
