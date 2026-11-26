package com.socialtask.wecom;

import com.socialtask.common.*;
import com.socialtask.task.TaskService;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.*;

/** Explicit conversation-scoped ticket creation and provenance lookup; never contacts WeCom. */
@RestController
@RequestMapping("/api/v1/wecom/inbox/conversations/{conversationId}/tickets")
public class WecomTicketController {
    private final Db db;
    private final TaskService tasks;
    public WecomTicketController(Db db,TaskService tasks){this.db=db;this.tasks=tasks;}

    private void requireConversation(long conversationId) {
        db.one("SELECT id FROM wecom_conversations WHERE id=? AND channel='WECOM_APP'",conversationId);
    }

    @GetMapping
    public List<Map<String,Object>> related(@PathVariable long conversationId) {
        Access.admin();
        requireConversation(conversationId);
        return db.list("""
            SELECT t.id,t.task_no,t.title,t.status,t.priority,t.due_at,t.source_message_id,p.name AS assignee_name
            FROM wecom_messages m JOIN tasks t ON t.source_message_id=m.id
            JOIN people p ON p.id=t.assignee_id
            WHERE m.conversation_id=? AND m.direction='INBOUND'
            ORDER BY t.id DESC LIMIT 50
            """,conversationId);
    }

    @PostMapping @Transactional
    public Map<String,Object> create(@PathVariable long conversationId,@RequestBody TaskService.TicketIn input) {
        Access.admin();
        requireConversation(conversationId);
        Db.badIf(input==null||input.sourceMessageId()==null||input.sourceMessageId()<=0,"必须选择当前会话的入站来源消息");
        // Lock source until the existing ticket transaction has persisted its foreign key.
        var source=db.optional("SELECT id FROM wecom_messages WHERE id=? AND conversation_id=? AND direction='INBOUND' AND delivery_status<>'REDACTED' FOR UPDATE",input.sourceMessageId(),conversationId);
        Db.ensure(source!=null,"来源消息不属于当前会话、已清理或并非入站消息");
        return tasks.createTicket(input);
    }
}
