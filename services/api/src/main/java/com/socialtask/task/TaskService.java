package com.socialtask.task;

import com.socialtask.auth.AuthService;
import com.socialtask.sla.SlaService;
import com.socialtask.common.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;

@Service
public class TaskService {
    private final Db db; private final Audit audit;private final SlaService sla; private final TicketTemplateRepository templates;
    public TaskService(Db db,Audit audit,SlaService sla){ this.db=db;this.audit=audit;this.sla=sla;this.templates=new TicketTemplateRepository(db); }

    public record TaskSubmit(Map<String,Object> payload,Long attachmentId) {}
    public record TaskReview(String decision,String reason) {}
    public record TaskTransfer(long assigneeId,String reason,String deadline) {}
    public record TicketIn(String title,String description,long assigneeId,String deadline,String priority,Long sourceMessageId,
                           String templateKey,Integer templateVersion,Map<String,Object> fieldValues) {
        public TicketIn(String title,String description,long assigneeId,String deadline,String priority,Long sourceMessageId) {
            this(title,description,assigneeId,deadline,priority,sourceMessageId,null,null,null);
        }
    }
    public record TaskFilters(String q,String status,String type,String group,Long tagId,String priority,String sla) {}

    public static Instant deadline(String input) {
        try { Instant time=Instant.parse(input);if(time.isBefore(Instant.now().minusSeconds(30))) throw new Exception();return time; }
        catch(Exception e) { throw new ApiException(400,"截止时间应为未来的 ISO-8601 UTC 时间，例如 2026-11-25T10:00:00Z"); }
    }
    public static String number(String prefix) {
        return prefix+LocalDate.now(Rules.BUSINESS_ZONE).toString().replace("-","")+UUID.randomUUID().toString().substring(0,10).replace("-","").toUpperCase(Locale.ROOT);
    }
    @Transactional public Map<String,Object> createBatch(TaskController.BatchIn body) {
        var actor=Access.admin();
        Db.required(body.title(),"批次名称",200); var content=db.one("SELECT id,review_status FROM content_packages WHERE id=?",body.contentId());
        Db.ensure("APPROVED".equals(content.get("review_status")),"只有审核通过的内容包可以下发");
        if(body.assigneeIds()==null || body.assigneeIds().isEmpty() || body.assigneeIds().size()>500) throw new ApiException(400,"单批次分派人员须为 1–500 人");
        if(new HashSet<>(body.assigneeIds()).size()!=body.assigneeIds().size()) throw new ApiException(400,"批次人员不能重复");
        Instant due=deadline(body.deadline());
        int interval=body.reminderInterval()==null?60:body.reminderInterval();
        int max=body.reminderMax()==null?10:body.reminderMax();
        if(interval<5 || interval>1440 || max<1 || max>10) throw new ApiException(400,"催办参数超出范围");
        for(long assignee:body.assigneeIds()) {
            var p=db.one("SELECT person_type,status FROM people WHERE id=?",assignee);
            Db.ensure("ACTIVE".equals(p.get("status")) && Set.of("creator","author").contains(p.get("person_type")),"发布人必须为在用作者/素人");
        }
        long batch=db.insert("INSERT INTO publish_batches(title,content_id,deadline_at,created_by) VALUES(?,?,?,?)",body.title(),body.contentId(),Db.stamp(due),actor.id());
        String priority=body.priority()==null?"NORMAL":body.priority();
        for(long id:body.assigneeIds()) {
            long taskId=newTask("PUBLISH",body.title(),id,due,batch,null,null,null,Map.of("content_id",body.contentId()),interval,max,actor.id());
            if(!"NORMAL".equals(priority))sla.reprioritize(taskId,priority);
        }
        audit.record(actor.id(),"publish_batch",batch,"CREATE",Map.of("count",body.assigneeIds().size()));
        return Map.of("id",batch,"task_count",body.assigneeIds().size(),"title",body.title());
    }
    public List<Map<String,Object>> batches() {Access.admin();return db.list("SELECT b.*,c.title AS content_title,(SELECT COUNT(*) FROM tasks t WHERE t.batch_id=b.id) AS task_count FROM publish_batches b JOIN content_packages c ON b.content_id=c.id ORDER BY b.id DESC LIMIT 300");}
    public long newTask(String type,String title,long assignee,Instant due,Long batchId,Long workId,Long customerId,Long roundId,Map<String,Object> payload,int interval,int max,Long actor) {
        Instant first=due.minus(Duration.ofMinutes(30));if(first.isBefore(Instant.now())) first=Instant.now().plusSeconds(60);
        String taskNo=number(switch(type){case "PUBLISH"->"PUB";case "OFFICIAL_COMMENT"->"COM";case "CONTACT_AUTHOR","CONTACT_ASSISTANT"->"DM";case "SERVICE_TICKET"->"TKT";default->"FOL";});
        long id=db.insert("INSERT INTO tasks(task_no,title,type,assignee_id,batch_id,work_id,customer_id,round_id,due_at,payload_json,reminder_interval,reminder_max,next_remind_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            taskNo,title,type,assignee,batchId,workId,customerId,roundId,Db.stamp(due),db.json(payload),interval,max,Db.stamp(first));
        sla.attach(id,type,"NORMAL",Instant.now());
        notifyTask(id,assignee,"TASK_CREATED",taskNo+"："+title,"TASK:"+id+":CREATE");
        audit.record(actor,"task",id,"CREATE",Map.of("task_no",taskNo,"type",type,"assignee_id",assignee));
        return id;
    }
    public void notifyTask(Long taskId,long person,String event,String message,String key) {
        db.execute("INSERT INTO notifications(event_key,task_id,person_id,event_type,details) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",key,taskId,person,event,message);
    }
    public List<Map<String,Object>> list(TaskFilters filters) {
        var actor=Access.who();
        StringBuilder sql=new StringBuilder("SELECT t.*,p.person_no,p.name AS assignee_name,p.group_name,s.response_due_at,s.resolution_due_at,s.first_response_at,s.resolved_at, "
            + "CASE WHEN s.response_breached_at IS NOT NULL OR s.resolution_breached_at IS NOT NULL "
            + "OR (t.status NOT IN ('CANCELLED','STOPPED') AND ((s.first_response_at IS NULL AND s.response_due_at < UTC_TIMESTAMP(3)) OR (s.resolved_at IS NULL AND s.resolution_due_at < UTC_TIMESTAMP(3)))) THEN 'BREACHED' "
            + "WHEN t.status IN ('COMPLETED','CANCELLED','STOPPED') THEN 'MET' "
            + "WHEN (s.first_response_at IS NULL AND s.response_due_at <= DATE_ADD(UTC_TIMESTAMP(3),INTERVAL sp.response_warning_minutes MINUTE)) "
            + "OR (s.resolved_at IS NULL AND s.resolution_due_at <= DATE_ADD(UTC_TIMESTAMP(3),INTERVAL sp.resolution_warning_minutes MINUTE)) THEN 'AT_RISK' ELSE 'ON_TRACK' END AS sla_state "
            + "FROM tasks t JOIN people p ON p.id=t.assignee_id LEFT JOIN task_sla s ON s.task_id=t.id LEFT JOIN sla_policies sp ON sp.id=s.policy_id WHERE 1=1");
        List<Object> args=new ArrayList<>();
        if(!Access.isAdmin()){
            if(actor.personId()==null)return List.of();
            sql.append(" AND t.assignee_id=?");args.add(actor.personId());
        }
        if(filters!=null){
            if(filters.q()!=null&&!filters.q().isBlank()){sql.append(" AND (t.task_no LIKE ? OR t.title LIKE ? OR p.name LIKE ?)");String text="%"+filters.q().trim()+"%";Collections.addAll(args,text,text,text);}
            if(filters.status()!=null&&!filters.status().isBlank()){sql.append(" AND t.status=?");args.add(filters.status());}
            if(filters.type()!=null&&!filters.type().isBlank()){sql.append(" AND t.type=?");args.add(filters.type());}
            if(filters.group()!=null&&!filters.group().isBlank()){sql.append(" AND p.group_name=?");args.add(filters.group());}
            if(filters.tagId()!=null){sql.append(" AND EXISTS(SELECT 1 FROM people_tag_links l WHERE l.person_id=p.id AND l.tag_id=?)");args.add(filters.tagId());}
            if(filters.priority()!=null&&!filters.priority().isBlank()){sql.append(" AND t.priority=?");args.add(filters.priority());}
            if(filters.sla()!=null&&!filters.sla().isBlank()){
                if(!Set.of("BREACHED","AT_RISK","ON_TRACK","MET").contains(filters.sla()))throw new ApiException(400,"SLA 筛选值不合法");
                sql.append(" HAVING sla_state=?");args.add(filters.sla());
            }
        }
        sql.append(" ORDER BY t.id DESC LIMIT 500");return db.list(sql.toString(),args.toArray());
    }
    @Transactional public Map<String,Object> createTicket(TicketIn input){
        var actor=Access.admin();String title=Db.required(input.title(),"工单标题",240);String desc=Db.required(input.description(),"工单描述",3000);
        var assignee=db.one("SELECT person_type,status FROM people WHERE id=?",input.assigneeId());
        Db.ensure("ACTIVE".equals(assignee.get("status")) && Set.of("support","assistant").contains(assignee.get("person_type")),"普通服务工单须分配给在用客服或官方助理");
        Long source=input.sourceMessageId();
        if(source!=null){var msg=db.one("SELECT direction,delivery_status FROM wecom_messages WHERE id=? FOR UPDATE",source);Db.ensure("INBOUND".equals(msg.get("direction"))&&!"REDACTED".equals(msg.get("delivery_status")),"只可关联未清理的真实入站应用消息");}
        Map<String,Object> payload = new LinkedHashMap<>();
        payload.put("description",desc);
        TicketTemplate.Snapshot snapshot = null;
        if(input.templateKey()!=null || input.templateVersion()!=null || input.fieldValues()!=null&&!input.fieldValues().isEmpty()){
            snapshot = templates.dispatch(input.templateKey(),input.templateVersion(),input.fieldValues());
            payload.put("template_snapshot",snapshot);
        }
        long id=newTask("SERVICE_TICKET",title,input.assigneeId(),deadline(input.deadline()),null,null,null,null,payload,30,5,actor.id());
        if(snapshot!=null) for(long assetId:snapshot.assetIds())
            db.execute("INSERT INTO ticket_material_assets(task_id,attachment_id) VALUES(?,?)",id,assetId);
        if(source!=null)db.execute("UPDATE tasks SET source_message_id=? WHERE id=?",source,id);
        String priority=input.priority()==null?"NORMAL":input.priority();
        if(!"NORMAL".equals(priority))sla.reprioritize(id,priority);
        return get(id);
    }
    public Map<String,Object> get(long id) {
        var task=db.one("SELECT t.*,p.name AS assignee_name,p.person_no FROM tasks t JOIN people p ON p.id=t.assignee_id WHERE t.id=?",id);
        Access.ownsTask(Db.l(task.get("assignee_id")));
        Map<String,Object> result=new LinkedHashMap<>(task);
        if(task.get("batch_id")!=null) {
            var content=db.one("SELECT c.* FROM publish_batches b JOIN content_packages c ON c.id=b.content_id WHERE b.id=?",task.get("batch_id"));
            result.put("content",content);
        }
        if(task.get("work_id")!=null) result.put("work",db.one("SELECT id,work_url,verify_status FROM works WHERE id=?",task.get("work_id")));
        if(task.get("customer_id")!=null) result.put("customer",db.one("SELECT id,customer_no,nickname,status,do_not_contact FROM customers WHERE id=?",task.get("customer_id")));
        result.put("sla",db.optional("SELECT s.*,sp.name AS policy_name,sp.calendar_mode FROM task_sla s JOIN sla_policies sp ON sp.id=s.policy_id WHERE s.task_id=?",id));
        result.put("submissions",db.list("SELECT id,revision,payload_json,attachment_id,review_status,submitted_at FROM task_submissions WHERE task_id=? ORDER BY revision DESC LIMIT 10",id));
        return result;
    }
    private Map<String,Object> locked(long id){return db.one("SELECT * FROM tasks WHERE id=? FOR UPDATE",id);}
    @Transactional public Map<String,Object> submit(long taskId,TaskSubmit body) {
        var actor=Access.who();
        var preview=db.one("SELECT customer_id,type FROM tasks WHERE id=?",taskId);
        boolean isContact=Rules.CONTACT_TYPES.contains(Db.str(preview.get("type")));
        if(isContact) db.one("SELECT * FROM customers WHERE id=? FOR UPDATE",preview.get("customer_id")); // serialize simultaneous contact updates
        var task=locked(taskId);
        if(actor.personId()==null || actor.personId()!=Db.l(task.get("assignee_id"))) throw new ApiException(403,"任务只能由当前执行人员提交");
        Db.ensure(Rules.maySubmit(Db.str(task.get("status"))),"该任务不能再次提交");
        Map<String,Object> payload=body.payload()==null?new HashMap<>():new HashMap<>(body.payload());
        Long attachmentId=body.attachmentId();
        String type=Db.str(task.get("type"));
        if(!isContact && attachmentId!=null) throw new ApiException(400,"当前任务类型不需要截图附件");
        if(type.equals("PUBLISH")) {
            String url=Rules.canonicalDouyin(Db.str(payload.get("work_url")));
            String hash=AuthService.sha256(url);
            Map<String,Object> current=db.optional("SELECT id FROM works WHERE task_id=?",taskId);
            Map<String,Object> another=db.optional("SELECT id,task_id FROM works WHERE url_hash=?",hash);
            Db.ensure(another==null || Db.l(another.get("task_id"))==taskId,"该作品链接已经被其他任务使用");
            if(current==null) {
                long workId=db.insert("INSERT INTO works(task_id,author_person_id,work_url,url_hash) VALUES(?,?,?,?)",taskId,task.get("assignee_id"),url,hash);
                db.execute("UPDATE tasks SET work_id=? WHERE id=?",workId,taskId);
            } else db.execute("UPDATE works SET work_url=?,url_hash=?,verify_status='PENDING' WHERE task_id=?",url,hash,taskId);
            payload.put("work_url",url);
        } else if(type.equals("OFFICIAL_COMMENT")) {
            if(!Boolean.TRUE.equals(payload.get("confirmed"))) throw new ApiException(400,"必须由执行人确认已发布官方评论");
            if(attachmentId!=null) throw new ApiException(400,"官方助理评论无需上传截图");
        } else if(isContact) {
            Map<String,Object> customer=db.one("SELECT * FROM customers WHERE id=?",task.get("customer_id"));
            Rules.requirePermission(Db.bool(customer.get("contact_allowed")),Db.bool(customer.get("do_not_contact")),Db.str(customer.get("consent_basis")));
            if(attachmentId==null) throw new ApiException(400,"联系任务必须上传真实沟通截图");
            Map<String,Object> attachment=db.one("SELECT owner_user_id,purpose FROM attachments WHERE id=?",attachmentId);
            if(Db.l(attachment.get("owner_user_id"))!=actor.id() || !"PRIVATE_MESSAGE".equals(attachment.get("purpose")))
                throw new ApiException(403,"截图不属于当前执行人或用途不匹配");
            String reply=Db.str(payload.get("reply_status"));
            if(!Set.of("REPLIED","NO_REPLY","UNKNOWN","REFUSED").contains(reply)) throw new ApiException(400,"联系结果无效");
            db.execute("INSERT INTO contact_attempts(round_id,task_id,person_id,reply_status,attachment_id) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE reply_status=VALUES(reply_status),attachment_id=VALUES(attachment_id),created_at=CURRENT_TIMESTAMP(3)",
                task.get("round_id"),taskId,task.get("assignee_id"),reply,attachmentId);
            if(Rules.mustStopOther(reply)) stopOtherContacts(taskId,Db.l(task.get("customer_id")),reply,actor.id());
        } else if(type.equals("SERVICE_TICKET")) {
            Db.required(Db.str(payload.get("notes")),"工单处理结果",3000);
            var ticketPayload = db.object(task.get("payload_json"));
            Object snapshot = ticketPayload.get("template_snapshot");
            if(snapshot instanceof Map<?,?> saved) {
                Object requested = payload.get("fieldValues");
                Db.badIf(requested!=null && !(requested instanceof Map<?,?>),"回传字段须为对象");
                payload.put("fieldValues",templates.parse(saved.get("template")).response((Map<?,?>)requested));
            } else {
                Db.badIf(payload.containsKey("fieldValues"),"工单未配置自定义回传字段");
            }
        } else throw new ApiException(400,"未知任务类型");
        int revision=Db.n(task.get("version"));
        db.insert("INSERT INTO task_submissions(task_id,actor_user_id,revision,payload_json,attachment_id) VALUES(?,?,?,?,?)",taskId,actor.id(),revision,db.json(payload),attachmentId);
        db.execute("UPDATE tasks SET status='SUBMITTED',next_remind_at=NULL,version=version+1 WHERE id=?",taskId);
        sla.markResponded(taskId);
        audit.record(actor.id(),"task",taskId,"SUBMIT",Map.of("revision",revision));
        return get(taskId);
    }
    private void stopOtherContacts(long excludingTask,long customerId,String reply,long actorId) {
        boolean refused=reply.equals("REFUSED");
        db.execute("UPDATE customers SET status=?,do_not_contact=? WHERE id=?",refused?"REFUSED":"RESPONDED",refused,customerId);
        var others=db.list("SELECT id,assignee_id FROM tasks WHERE customer_id=? AND id<>? AND type IN ('CONTACT_AUTHOR','CONTACT_ASSISTANT','FOLLOWUP') AND status IN ('PENDING','REWORK') FOR UPDATE",customerId,excludingTask);
        for(var target:others) {
            long otherId=Db.id(target);
            db.execute("UPDATE tasks SET status='STOPPED',next_remind_at=NULL WHERE id=?",otherId);
            notifyTask(otherId,Db.l(target.get("assignee_id")),"TASK_STOPPED","客户已经回复或拒绝联系，停止重复联系","TASK:"+otherId+":STOP");
        }
        db.execute("UPDATE contact_rounds SET status=? WHERE customer_id=? AND status='ACTIVE'",refused?"REFUSED":"RESPONDED",customerId);
        audit.record(actorId,"customer",customerId,refused?"DO_NOT_CONTACT":"RESPONDED",Map.of("stop_count",others.size()));
    }
    @Transactional public Map<String,Object> review(long id,TaskReview body) {
        var actor=Access.admin();var task=locked(id);
        Db.ensure(Rules.mayReview(Db.str(task.get("status"))),"仅已提交任务可审核");
        if(!Set.of("APPROVE","REJECT").contains(body.decision())) throw new ApiException(400,"审核状态错误");
        if(body.decision().equals("REJECT") && (body.reason()==null || body.reason().isBlank())) throw new ApiException(400,"退回原因必填");
        boolean approved=body.decision().equals("APPROVE");
        db.execute("UPDATE tasks SET status=?,next_remind_at=?,version=version+1 WHERE id=?",approved?"COMPLETED":"REWORK",approved?null:Db.stamp(Instant.now().plusSeconds(60)),id);
        db.execute("UPDATE task_submissions SET review_status=? WHERE task_id=? AND revision=(SELECT mx FROM (SELECT MAX(revision) mx FROM task_submissions WHERE task_id=?) d)",approved?"APPROVED":"REJECTED",id,id);
        if(approved)sla.markResolved(id);
        if("PUBLISH".equals(task.get("type"))) db.execute("UPDATE works SET verify_status=? WHERE task_id=?",approved?"VERIFIED":"REJECTED",id);
        notifyTask(id,Db.l(task.get("assignee_id")),approved?"REVIEW_APPROVED":"REVIEW_REWORK",approved?"任务审核已通过":"任务被退回："+body.reason(),"TASK:"+id+":REVIEW:"+Db.n(task.get("version")));
        audit.record(actor.id(),"task",id,approved?"APPROVE":"REJECT",Map.of("reason",body.reason()==null?"":body.reason()));
        return get(id);
    }
    @Transactional public Map<String,Object> cancel(long id) {
        var actor=Access.admin();var task=locked(id);
        Db.ensure(!Rules.TERMINAL.contains(Db.str(task.get("status"))),"终态任务不能取消");
        db.execute("UPDATE tasks SET status='CANCELLED',next_remind_at=NULL,version=version+1 WHERE id=?",id);
        audit.record(actor.id(),"task",id,"CANCEL",Map.of("previous_status",task.get("status")));
        return get(id);
    }
    @Transactional public Map<String,Object> transfer(long id,TaskTransfer input) {
        var actor=Access.admin(); var task=locked(id);
        Db.ensure(Rules.maySubmit(Db.str(task.get("status"))) || "PAUSED".equals(task.get("status")),"仅未提交或暂停的任务可转派");
        var p=db.one("SELECT * FROM people WHERE id=?",input.assigneeId());
        Db.ensure("ACTIVE".equals(p.get("status")),"人员不在用");
        String needed=switch(Db.str(task.get("type"))){case "OFFICIAL_COMMENT","CONTACT_ASSISTANT"->"assistant";case "CONTACT_AUTHOR"->"author";case "FOLLOWUP"->"support";case "SERVICE_TICKET"->"support";default->"creator";};
        if("PUBLISH".equals(task.get("type"))) Db.ensure(Set.of("creator","author").contains(p.get("person_type")),"发布任务只能转给作者或素人");
        else if("SERVICE_TICKET".equals(task.get("type"))) Db.ensure(Set.of("support","assistant").contains(p.get("person_type")),"普通服务工单只能转派授权客服或官方助理");
        else Db.ensure(needed.equals(p.get("person_type")),"接收人角色不符");
        Db.required(input.reason(),"转派原因",500);
        Instant due=input.deadline()==null?Db.instant(task.get("due_at")):deadline(input.deadline());
        db.execute("UPDATE tasks SET assignee_id=?,due_at=?,next_remind_at=?,reminder_count=0,status=CASE WHEN status='PAUSED' THEN 'PENDING' ELSE status END,version=version+1 WHERE id=?",
            input.assigneeId(),Db.stamp(due),Db.stamp(Instant.now().plusSeconds(60)),id);
        notifyTask(id,input.assigneeId(),"TASK_TRANSFERRED","任务转派给您","TASK:"+id+":TRANSFER:"+Db.n(task.get("version")));
        audit.record(actor.id(),"task",id,"TRANSFER",Map.of("from",task.get("assignee_id"),"to",input.assigneeId(),"reason",input.reason()));
        return get(id);
    }
}
