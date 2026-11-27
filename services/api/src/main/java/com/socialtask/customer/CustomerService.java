package com.socialtask.customer;

import com.socialtask.auth.AuthService;
import com.socialtask.common.*;
import com.socialtask.task.TaskService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;

@Service
public class CustomerService {
    private final Db db;private final Audit audit;private final TaskService tasks;
    public CustomerService(Db db,Audit audit,TaskService tasks){this.db=db;this.audit=audit;this.tasks=tasks;}
    public record NewCustomer(String nickname,String externalUid,String profileUrl,boolean identityVerified,
                              Long sourceWorkId,Long sourceCommentId,boolean contactAllowed,String consentBasis){}
    public record ContactPermission(boolean contactAllowed,String consentBasis){}
    public record FirstRound(long authorId,long assistantId,String privateMessage,String authorMessage,String assistantMessage,String deadline){}
    public record StopContact(String reason){}

    @Transactional public Map<String,Object> create(NewCustomer body) {
        var actor=Access.admin(); Db.required(body.nickname(),"客户昵称",160);
        if(body.contactAllowed()) Rules.requirePermission(true,false,body.consentBasis());
        if(body.sourceCommentId()!=null && body.sourceWorkId()==null) throw new ApiException(400,"关联评论时必须指定来源作品");
        // Never deduplicate by nickname. Each verified identity independently resolves to one customer.
        Map<String,String> identities=new LinkedHashMap<>();
        if(body.identityVerified()) {
            if(body.externalUid()!=null && !body.externalUid().isBlank()) identities.put("UID",AuthService.sha256(body.externalUid().trim()));
            if(body.profileUrl()!=null && !body.profileUrl().isBlank()) identities.put("PROFILE",AuthService.sha256(Rules.canonicalProfileDouyin(body.profileUrl())));
            if(identities.isEmpty()) throw new ApiException(400,"已核验客户必须提供 UID 或账号主页");
        }
        Set<Long> matches=new HashSet<>();
        for(var entry:identities.entrySet()) {
            var matched=db.optional("SELECT customer_id FROM customer_identities WHERE platform='douyin' AND identity_kind=? AND identity_hash=?",entry.getKey(),entry.getValue());
            if(matched!=null) matches.add(Db.l(matched.get("customer_id")));
        }
        if(matches.size()>1) throw new ApiException(409,"身份信息指向不同客户，需要管理员核验合并，系统不会自动覆盖档案");
        long id;
        if(matches.isEmpty()) {
            id=db.insert("INSERT INTO customers(customer_no,nickname,status,contact_allowed,consent_basis) VALUES(?,?,?,?,?)",
                TaskService.number("C"),body.nickname().strip(),"NEW",body.contactAllowed(),body.consentBasis());
            audit.record(actor.id(),"customer",id,"CREATE",Map.of("identity_verified",body.identityVerified()));
        } else id=matches.iterator().next();
        for(var entry:identities.entrySet()) {
            var found=db.optional("SELECT customer_id FROM customer_identities WHERE platform='douyin' AND identity_kind=? AND identity_hash=?",entry.getKey(),entry.getValue());
            if(found==null) db.execute("INSERT INTO customer_identities(customer_id,platform,identity_kind,identity_hash) VALUES(?,?,?,?)",id,"douyin",entry.getKey(),entry.getValue());
            else Db.ensure(Db.l(found.get("customer_id"))==id,"身份标识冲突，需要人工核验");
        }
        if(body.sourceWorkId()!=null) {
            db.one("SELECT id FROM works WHERE id=?",body.sourceWorkId());
            if(body.sourceCommentId()!=null) {
                var comment=db.one("SELECT work_id FROM comments WHERE id=?",body.sourceCommentId());
                Db.ensure(Db.l(comment.get("work_id"))==body.sourceWorkId(),"原始评论不属于指定作品");
            }
            String source="W"+body.sourceWorkId()+"-C"+(body.sourceCommentId()==null?0:body.sourceCommentId());
            db.execute("INSERT INTO customer_sources(customer_id,work_id,comment_id,source_key) VALUES(?,?,?,?) ON CONFLICT (customer_id,source_key) DO NOTHING",
                id,body.sourceWorkId(),body.sourceCommentId(),source);
        }
        return detail(id);
    }
    public List<Map<String,Object>> list(String q,String status,Long segmentId,Long tagId) {
        Access.admin();
        StringBuilder sql=new StringBuilder("SELECT c.*,g.name AS segment_name, (SELECT COUNT(*) FROM customer_sources s WHERE s.customer_id=c.id) AS source_count, (SELECT string_agg(t.name, ',' ORDER BY t.name) FROM customer_tag_links l JOIN customer_tags t ON t.id=l.tag_id WHERE l.customer_id=c.id) AS tag_names, (SELECT string_agg(l.tag_id::text, ',' ORDER BY l.tag_id) FROM customer_tag_links l WHERE l.customer_id=c.id) AS tag_ids FROM customers c LEFT JOIN customer_segments g ON g.id=c.segment_id WHERE 1=1");
        List<Object> args=new ArrayList<>();
        if(q!=null&&!q.isBlank()) {sql.append(" AND (c.customer_no LIKE ? OR c.nickname LIKE ?)");String pat="%"+q.strip()+"%";args.add(pat);args.add(pat);}
        if(status!=null&&!status.isBlank()) {sql.append(" AND c.status=?");args.add(status);}
        if(segmentId!=null){sql.append(" AND c.segment_id=?");args.add(segmentId);}
        if(tagId!=null){sql.append(" AND EXISTS(SELECT 1 FROM customer_tag_links l WHERE l.customer_id=c.id AND l.tag_id=?)");args.add(tagId);}
        sql.append(" ORDER BY c.id DESC LIMIT 500");
        return db.list(sql.toString(),args.toArray());
    }
    public List<Map<String,Object>> segments(){Access.admin();return db.list("SELECT s.*,(SELECT COUNT(*) FROM customers c WHERE c.segment_id=s.id) AS customer_count FROM customer_segments s ORDER BY s.id");}
    public List<Map<String,Object>> tags(){Access.admin();return db.list("SELECT t.*,(SELECT COUNT(*) FROM customer_tag_links l WHERE l.tag_id=t.id) AS customer_count FROM customer_tags t ORDER BY t.id");}
    @Transactional public Map<String,Object> addSegment(String name,String description){
        var user=Access.admin();String safe=Db.required(name,"客户分组",100);
        long id=db.insert("INSERT INTO customer_segments(name,description) VALUES(?,?)",safe,description==null?"":description.strip());
        audit.record(user.id(),"customer_segment",id,"CREATE",Map.of("name",safe));
        return db.one("SELECT * FROM customer_segments WHERE id=?",id);
    }
    @Transactional public Map<String,Object> addTag(String name){
        var user=Access.admin();String safe=Db.required(name,"客户标签",60);
        long id=db.insert("INSERT INTO customer_tags(name) VALUES(?)",safe);
        audit.record(user.id(),"customer_tag",id,"CREATE",Map.of("name",safe));
        return db.one("SELECT * FROM customer_tags WHERE id=?",id);
    }
    @Transactional public Map<String,Object> classify(long customerId,Long segmentId,List<Long> tagIds){
        var user=Access.admin();
        db.one("SELECT id FROM customers WHERE id=? FOR UPDATE",customerId);
        if(segmentId==null)throw new ApiException(400,"客户分组不能为空");
        var segment=db.one("SELECT id,active FROM customer_segments WHERE id=?",segmentId);
        if(!Db.bool(segment.get("active")))throw new ApiException(400,"客户分组已经停用");
        if(tagIds==null || tagIds.size()>30 || new HashSet<>(tagIds).size()!=tagIds.size())throw new ApiException(400,"最多设置 30 个不同客户标签");
        for(Long tagId:tagIds){if(tagId==null)throw new ApiException(400,"标签编号错误");db.one("SELECT id FROM customer_tags WHERE id=?",tagId);}
        db.execute("UPDATE customers SET segment_id=? WHERE id=?",segmentId,customerId);
        db.execute("DELETE FROM customer_tag_links WHERE customer_id=?",customerId);
        for(Long tagId:tagIds)db.execute("INSERT INTO customer_tag_links(customer_id,tag_id) VALUES(?,?)",customerId,tagId);
        audit.record(user.id(),"customer",customerId,"CLASSIFY",Map.of("segment_id",segmentId,"tag_ids",tagIds));
        return detail(customerId);
    }
    public Map<String,Object> detail(long customerId) {
        var c=db.one("SELECT * FROM customers WHERE id=?",customerId);
        if(!Access.isAdmin()) {
            if(Access.who().personId()==null) throw new ApiException(403,"无客户访问权限");
            var has=db.optional("SELECT id FROM tasks WHERE customer_id=? AND assignee_id=? LIMIT 1",customerId,Access.who().personId());
            if(has==null) throw new ApiException(403,"无权访问未分派客户");
        }
        Map<String,Object> result=new LinkedHashMap<>(c);
        // Customer classifications are private CRM metadata and not visible to external task assignees.
        if(Access.isAdmin()) {
            var sg=db.optional("SELECT name FROM customer_segments WHERE id=?",c.get("segment_id"));
            result.put("segment_name",sg==null?"未分组":sg.get("name"));
            var tags=db.list("SELECT t.id,t.name FROM customer_tag_links l JOIN customer_tags t ON t.id=l.tag_id WHERE l.customer_id=? ORDER BY t.name",customerId);
            result.put("tags",tags);
            result.put("tag_ids",tags.stream().map(t->Db.id(t)).toList());
        }
        result.put("sources",db.list("SELECT s.id,s.work_id,s.comment_id,w.work_url FROM customer_sources s JOIN works w ON w.id=s.work_id WHERE s.customer_id=? ORDER BY s.id",customerId));
        result.put("contact_rounds",db.list("SELECT id,round_no,status,created_at FROM contact_rounds WHERE customer_id=? ORDER BY round_no",customerId));
        result.put("timeline",db.list("SELECT t.id,t.task_no,t.title,t.type,t.status,t.assignee_id,p.name AS assignee_name,t.created_at,t.updated_at FROM tasks t JOIN people p ON p.id=t.assignee_id WHERE t.customer_id=? ORDER BY t.created_at,t.id",customerId));
        return result; // Attachment IDs and raw screenshots never exposed in customer details.
    }
    @Transactional public Map<String,Object> permission(long id,ContactPermission body) {
        var actor=Access.admin();var c=db.one("SELECT * FROM customers WHERE id=? FOR UPDATE",id);
        if(Db.bool(c.get("do_not_contact")) && body.contactAllowed()) throw new ApiException(409,"已经拒绝联系的客户禁止直接重新开启外联");
        if(body.contactAllowed()) Rules.requirePermission(true,false,body.consentBasis());
        db.execute("UPDATE customers SET contact_allowed=?,consent_basis=? WHERE id=?",body.contactAllowed(),body.consentBasis(),id);
        audit.record(actor.id(),"customer",id,"CONTACT_PERMISSION",Map.of("allowed",body.contactAllowed()));
        return detail(id);
    }
    @Transactional public Map<String,Object> doNotContact(long id,String reason) {
        var actor=Access.admin();Db.required(reason,"停止联系原因",500);
        db.one("SELECT id FROM customers WHERE id=? FOR UPDATE",id);
        db.execute("UPDATE customers SET do_not_contact=TRUE,contact_allowed=FALSE,status='REFUSED' WHERE id=?",id);
        var active=db.list("SELECT id,assignee_id FROM tasks WHERE customer_id=? AND status IN ('PENDING','REWORK') AND type IN ('CONTACT_AUTHOR','CONTACT_ASSISTANT','FOLLOWUP') FOR UPDATE",id);
        for(var t:active){
            db.execute("UPDATE tasks SET status='STOPPED',next_remind_at=NULL WHERE id=?",Db.id(t));
            tasks.notifyTask(Db.id(t),Db.l(t.get("assignee_id")),"TASK_STOPPED","客户拒绝联系，禁止继续联系","TASK:"+Db.id(t)+":STOP");
        }
        db.execute("UPDATE contact_rounds SET status='REFUSED' WHERE customer_id=? AND status='ACTIVE'",id);
        audit.record(actor.id(),"customer",id,"DO_NOT_CONTACT",Map.of("reason",reason,"stopped",active.size()));
        return detail(id);
    }
    @Transactional public Map<String,Object> firstRound(long id,FirstRound body) {
        var actor=Access.admin(); var customer=db.one("SELECT * FROM customers WHERE id=? FOR UPDATE",id);
        Rules.requirePermission(Db.bool(customer.get("contact_allowed")),Db.bool(customer.get("do_not_contact")),Db.str(customer.get("consent_basis")));
        Db.ensure(!"RESPONDED".equals(customer.get("status")),"客户已回复，不应重复派发首次外联");
        Db.ensure(db.optional("SELECT id FROM contact_rounds WHERE customer_id=? AND round_no=1",id)==null,"首轮联系任务已存在");
        if(body.authorId()==body.assistantId()) throw new ApiException(400,"作者和官方助理不能是同一执行人");
        var author=db.one("SELECT person_type,status FROM people WHERE id=?",body.authorId());
        var assistant=db.one("SELECT person_type,status FROM people WHERE id=?",body.assistantId());
        Db.ensure("author".equals(author.get("person_type")) && "ACTIVE".equals(author.get("status")),"作者必须为启用状态");
        Db.ensure("assistant".equals(assistant.get("person_type")) && "ACTIVE".equals(assistant.get("status")),"助理必须为启用的官方助理");
        String authorMessage=body.authorMessage()!=null?body.authorMessage():body.privateMessage();
        String assistantMessage=body.assistantMessage()!=null?body.assistantMessage():body.privateMessage();
        Db.required(authorMessage,"作者私信内容",2000);Db.required(assistantMessage,"助理私信内容",2000);
        Instant due=TaskService.deadline(body.deadline());
        long round=db.insert("INSERT INTO contact_rounds(customer_id,round_no) VALUES(?,1)",id);
        long first=tasks.newTask("CONTACT_AUTHOR","客户首次联系·作者",body.authorId(),due,null,null,id,round,
            Map.of("private_message",authorMessage,"disclose_identity",true),30,3,actor.id());
        long second=tasks.newTask("CONTACT_ASSISTANT","客户首次联系·官方助理",body.assistantId(),due,null,null,id,round,
            Map.of("private_message",assistantMessage,"disclose_identity",true),30,3,actor.id());
        audit.record(actor.id(),"contact_round",round,"CREATE",Map.of("author_task",first,"assistant_task",second));
        return Map.of("id",round,"author_task_id",first,"assistant_task_id",second,"status","ACTIVE");
    }
}
