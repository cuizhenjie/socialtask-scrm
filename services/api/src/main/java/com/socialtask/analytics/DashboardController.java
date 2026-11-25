package com.socialtask.analytics;

import com.socialtask.common.*;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/dashboard")
public class DashboardController {
    private final Db db;
    public DashboardController(Db db){this.db=db;}
    private long count(String query){return Db.l(db.one(query).get("n"));}
    @GetMapping public Map<String,Object> view() {
        Access.admin();Map<String,Object> summary=new LinkedHashMap<>();
        summary.put("total_tasks",count("SELECT COUNT(*) n FROM tasks"));
        summary.put("pending",count("SELECT COUNT(*) n FROM tasks WHERE status IN ('PENDING','REWORK')"));
        summary.put("completed",count("SELECT COUNT(*) n FROM tasks WHERE status='COMPLETED'"));
        summary.put("need_review",count("SELECT COUNT(*) n FROM tasks WHERE status='SUBMITTED'"));
        summary.put("overdue",count("SELECT COUNT(*) n FROM tasks WHERE overdue_at IS NOT NULL OR (due_at < UTC_TIMESTAMP(3) AND status IN ('PENDING','REWORK'))"));
        summary.put("works",count("SELECT COUNT(*) n FROM works"));
        summary.put("customers",count("SELECT COUNT(*) n FROM customers"));
        summary.put("people",count("SELECT COUNT(*) n FROM people"));
        summary.put("by_type",db.list("SELECT type,COUNT(*) total,SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) done FROM tasks GROUP BY type"));
        summary.put("recent_tasks",db.list("SELECT t.id,t.task_no,t.title,t.type,t.status,t.due_at,p.name AS assignee_name FROM tasks t JOIN people p ON p.id=t.assignee_id ORDER BY t.id DESC LIMIT 12"));
        return summary;
    }
}
