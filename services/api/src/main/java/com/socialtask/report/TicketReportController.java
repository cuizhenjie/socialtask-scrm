package com.socialtask.report;

import com.socialtask.common.*;
import org.springframework.web.bind.annotation.*;
import java.time.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/reports")
public class TicketReportController {
    private final Db db;
    public TicketReportController(Db db){this.db=db;}
    /** Aggregate over all first-class task tickets, excluding none by default. */
    @GetMapping("/tickets") public Map<String,Object> tickets(
        @RequestParam(required=false) String from,@RequestParam(required=false) String to,
        @RequestParam(required=false) String group,@RequestParam(required=false) Long tagId,
        @RequestParam(required=false) String type,@RequestParam(required=false) String status,
        @RequestParam(required=false) String priority){
        Access.admin();StringBuilder where=new StringBuilder(" WHERE 1=1");List<Object> args=new ArrayList<>();
        if(from!=null&&!from.isBlank()){try{LocalDate.parse(from);}catch(Exception e){throw new ApiException(400,"开始日期格式应为 YYYY-MM-DD");}where.append(" AND t.created_at>=?");args.add(from+" 00:00:00");}
        if(to!=null&&!to.isBlank()){try{LocalDate.parse(to);}catch(Exception e){throw new ApiException(400,"结束日期格式应为 YYYY-MM-DD");}where.append(" AND t.created_at<DATE_ADD(?,INTERVAL 1 DAY)");args.add(to+" 00:00:00");}
        if(from!=null&&to!=null&&!from.isBlank()&&!to.isBlank()&&LocalDate.parse(from).isAfter(LocalDate.parse(to)))throw new ApiException(400,"开始日期不能晚于结束日期");
        if(group!=null&&!group.isBlank()){where.append(" AND p.group_name=?");args.add(group);}
        if(tagId!=null){where.append(" AND EXISTS(SELECT 1 FROM people_tag_links pl WHERE pl.person_id=p.id AND pl.tag_id=?)");args.add(tagId);}
        if(type!=null&&!type.isBlank()){where.append(" AND t.type=?");args.add(type);}
        if(status!=null&&!status.isBlank()){where.append(" AND t.status=?");args.add(status);}
        if(priority!=null&&!priority.isBlank()){where.append(" AND t.priority=?");args.add(priority);}
        String base=" FROM tasks t JOIN people p ON p.id=t.assignee_id LEFT JOIN task_sla s ON s.task_id=t.id"+where;
        String responseBreach="(s.response_breached_at IS NOT NULL OR (s.paused_at IS NULL AND t.status NOT IN ('CANCELLED','STOPPED') AND s.first_response_at IS NULL AND s.response_due_at < UTC_TIMESTAMP(3)))";
        String resolveBreach="(s.resolution_breached_at IS NOT NULL OR (s.paused_at IS NULL AND t.status NOT IN ('CANCELLED','STOPPED') AND s.resolved_at IS NULL AND s.resolution_due_at < UTC_TIMESTAMP(3)))";
        String metrics="SELECT COUNT(*) AS total,COALESCE(SUM(t.status IN ('PENDING','REWORK')),0) AS pending,"+
            "COALESCE(SUM(t.status='SUBMITTED'),0) AS awaiting_review,COALESCE(SUM(t.status='COMPLETED'),0) AS completed,"+
            "COALESCE(SUM(t.status IN ('CANCELLED','STOPPED')),0) AS stopped,"+
            "COALESCE(SUM(s.paused_at IS NOT NULL AND t.status NOT IN ('COMPLETED','CANCELLED','STOPPED')),0) AS sla_paused,"+
            "COALESCE(SUM(t.overdue_at IS NOT NULL OR (t.due_at<UTC_TIMESTAMP(3) AND t.status IN ('PENDING','REWORK'))),0) AS deadline_overdue,"+
            "COALESCE(SUM("+responseBreach+"),0) AS response_breached,"+
            "COALESCE(SUM("+resolveBreach+"),0) AS resolution_breached,"+
            "COALESCE(SUM(t.status='COMPLETED' AND s.resolved_at<=s.resolution_due_at),0) AS resolution_sla_met,"+
            "ROUND(AVG(CASE WHEN s.resolved_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE,t.created_at,s.resolved_at) END),1) AS avg_resolution_minutes"+base;
        List<Object> input=new ArrayList<>(args);
        var summary=db.one(metrics,input.toArray());
        String dims="SELECT %s AS dimension,COUNT(*) AS total,COALESCE(SUM(t.status='COMPLETED'),0) AS completed,COALESCE(SUM("+resolveBreach+"),0) AS sla_breached"+base+" GROUP BY %s ORDER BY total DESC LIMIT 100";
        Map<String,Object> result=new LinkedHashMap<>();result.put("summary",summary);
        result.put("by_status",db.list(dims.formatted("t.status","t.status"),args.toArray()));
        result.put("by_type",db.list(dims.formatted("t.type","t.type"),args.toArray()));
        result.put("by_group",db.list(dims.formatted("p.group_name","p.group_name"),args.toArray()));
        result.put("by_priority",db.list(dims.formatted("t.priority","t.priority"),args.toArray()));
        result.put("by_assignee",db.list("SELECT p.id AS person_id,p.name,p.person_no,p.group_name,COUNT(*) AS total,COALESCE(SUM(t.status='COMPLETED'),0) AS completed,COALESCE(SUM("+resolveBreach+"),0) AS sla_breached"+base+" GROUP BY p.id,p.name,p.person_no,p.group_name ORDER BY total DESC LIMIT 100",args.toArray()));
        result.put("daily",db.list("SELECT DATE(t.created_at) AS day,COUNT(*) AS created,COALESCE(SUM(t.status='COMPLETED'),0) AS completed"+base+" GROUP BY DATE(t.created_at) ORDER BY day DESC LIMIT 60",args.toArray()));
        result.put("filters",Map.of("time_basis","created_at UTC","scope","all ticket types","sla_definition","review-approved completion"));
        return result;
    }
}
