package com.socialtask.work;

import com.socialtask.common.*;
import com.socialtask.task.TaskService;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class WorkController {
    private final Db db;private final Audit audit;private final TaskService tasks;
    public WorkController(Db db,Audit audit,TaskService tasks){this.db=db;this.audit=audit;this.tasks=tasks;}
    public record CommentIn(String nickname,String externalUid,String content,String category) {}
    public record CommentTask(long assistantId,String commentText,String deadline) {}
    @GetMapping("/works") public List<Map<String,Object>> works(){Access.admin();return db.list("SELECT w.*,p.name AS author_name FROM works w JOIN people p ON p.id=w.author_person_id ORDER BY w.id DESC LIMIT 500");}
    @GetMapping("/comments") public List<Map<String,Object>> comments(){Access.admin();return db.list("SELECT c.*,w.work_url FROM comments c JOIN works w ON w.id=c.work_id ORDER BY c.id DESC LIMIT 500");}
    @GetMapping("/works/{id}/comments") public List<Map<String,Object>> comments(@PathVariable long id){Access.admin();return db.list("SELECT * FROM comments WHERE work_id=? ORDER BY id DESC",id);}
    @PostMapping("/works/{id}/comments") @Transactional public Map<String,Object> comment(@PathVariable long id,@RequestBody CommentIn body){
        var actor=Access.admin();db.one("SELECT id FROM works WHERE id=?",id);
        Db.required(body.nickname(),"评论人昵称",160);Db.required(body.content(),"真实评论原文",10000);
        long comment=db.insert("INSERT INTO comments(work_id,nickname,external_uid,content,category) VALUES(?,?,?,?,?)",id,body.nickname(),body.externalUid(),body.content(),body.category()==null?"其他":body.category());
        audit.record(actor.id(),"comment",comment,"RECORD_REAL_COMMENT",Map.of("work_id",id));
        return db.one("SELECT * FROM comments WHERE id=?",comment);
    }
    @PostMapping("/works/{id}/comment-tasks") @Transactional public Map<String,Object> officialTask(@PathVariable long id,@RequestBody CommentTask body){
        var actor=Access.admin();var work=db.one("SELECT * FROM works WHERE id=?",id);
        Db.ensure("VERIFIED".equals(work.get("verify_status")),"作品尚未审核通过");
        var assignee=db.one("SELECT person_type,status FROM people WHERE id=?",body.assistantId());
        Db.ensure("ACTIVE".equals(assignee.get("status")) && "assistant".equals(assignee.get("person_type")),"必须是有效官方助理账号");
        Db.required(body.commentText(),"官方评论文案",2000);
        Db.ensure(db.optional("SELECT id FROM tasks WHERE work_id=? AND type='OFFICIAL_COMMENT' AND status IN ('PENDING','REWORK','SUBMITTED') LIMIT 1",id)==null,"该作品已有未完成的官方助理评论任务");
        long tid=tasks.newTask("OFFICIAL_COMMENT","官方助理公开评论",body.assistantId(),TaskService.deadline(body.deadline()),null,id,null,null,Map.of("comment_text",body.commentText()),10,5,actor.id());
        return Map.of("id",tid,"work_id",id,"status","PENDING");
    }
}
