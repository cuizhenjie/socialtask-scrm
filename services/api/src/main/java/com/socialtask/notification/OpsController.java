package com.socialtask.notification;

import com.socialtask.common.*;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class OpsController {
    private final SchedulerService scheduler;private final NotificationService notices;private final Db db;private final com.socialtask.sla.SlaService sla;private final com.socialtask.storage.AttachmentRetentionService attachments;
    public OpsController(SchedulerService scheduler,NotificationService notices,Db db,com.socialtask.sla.SlaService sla,com.socialtask.storage.AttachmentRetentionService attachments){this.scheduler=scheduler;this.notices=notices;this.db=db;this.sla=sla;this.attachments=attachments;}
    @GetMapping("/notifications") public List<Map<String,Object>> notifications(){return notices.list();}
    @PostMapping("/notifications/{id}/retry") public Map<String,Object> retry(@PathVariable long id){return notices.retry(id);}
    @GetMapping("/audit-logs") public List<Map<String,Object>> audits(){Access.admin();return db.list("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300");}
    @PostMapping("/ops/tick") public Map<String,Object> tick(){Access.admin();return Map.of("reminders",scheduler.remindDue(),"followups",scheduler.createFollowups(),"sla",sla.tick(),"notifications",notices.dispatch(),"attachments",attachments.purgeExpired());}
}
