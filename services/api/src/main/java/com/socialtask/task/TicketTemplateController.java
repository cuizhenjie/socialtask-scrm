package com.socialtask.task;

import com.socialtask.common.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/v1/ticket-templates")
public class TicketTemplateController {
    private final TicketTemplateRepository templates;
    public TicketTemplateController(Db db) { this.templates = new TicketTemplateRepository(db); }
    public record RevisionIn(String key, Integer expectedVersion, String title, List<TicketTemplate.Field> fields) {}

    @GetMapping public List<TicketTemplate> current() { Access.admin(); return templates.listCurrent(); }

    @PostMapping @Transactional public TicketTemplate publish(@RequestBody RevisionIn input) {
        var actor = Access.admin();
        return templates.publish(input.key(),input.expectedVersion(),input.title(),input.fields(),actor.id());
    }
}
