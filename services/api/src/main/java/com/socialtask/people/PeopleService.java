package com.socialtask.people;

import com.socialtask.auth.AuthService;
import com.socialtask.common.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;

@Service
public class PeopleService {
    private final Db db; private final Audit audit; private final AuthService auth; private final TransactionTemplate rowTx;
    public PeopleService(Db db,Audit audit,AuthService auth,PlatformTransactionManager txManager){
        this.db=db;this.audit=audit;this.auth=auth;
        this.rowTx=new TransactionTemplate(txManager);
        this.rowTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public List<Map<String,Object>> list(String q,String role,String group,String status,Long tagId) {
        Access.admin();
        StringBuilder sql=new StringBuilder("SELECT p.*, (SELECT STRING_AGG(t.name, ',' ORDER BY t.name) FROM people_tag_links l JOIN tags t ON t.id=l.tag_id WHERE l.person_id=p.id) AS tag_names, (SELECT STRING_AGG(l.tag_id::text, ',' ORDER BY l.tag_id) FROM people_tag_links l WHERE l.person_id=p.id) AS tag_ids FROM people p WHERE 1=1");
        List<Object> args=new ArrayList<>();
        if(q!=null&&!q.isBlank()){sql.append(" AND (p.name LIKE ? OR p.person_no LIKE ? OR p.wecom_userid LIKE ?)");String like="%"+q.trim()+"%";Collections.addAll(args,like,like,like);}
        if(role!=null&&!role.isBlank()){sql.append(" AND p.person_type=?");args.add(role);}
        if(group!=null&&!group.isBlank()){sql.append(" AND p.group_name=?");args.add(group);}
        if(status!=null&&!status.isBlank()){sql.append(" AND p.status=?");args.add(status);}
        if(tagId!=null){sql.append(" AND EXISTS(SELECT 1 FROM people_tag_links l WHERE l.person_id=p.id AND l.tag_id=?)");args.add(tagId);}
        sql.append(" ORDER BY p.id DESC LIMIT 500");return db.list(sql.toString(),args.toArray());
    }
    public List<Map<String,Object>> groups(){Access.admin();return db.list("SELECT g.*, (SELECT COUNT(*) FROM people p WHERE p.group_name=g.name) AS person_count FROM people_groups g ORDER BY g.id");}
    public List<Map<String,Object>> tags(){Access.admin();return db.list("SELECT t.*, (SELECT COUNT(*) FROM people_tag_links l WHERE l.tag_id=t.id) AS person_count FROM tags t ORDER BY t.id");}
    @Transactional public Map<String,Object> addGroup(String name,String description){
        var user=Access.admin();name=Db.required(name,"分组名称",100);
        long id=db.insert("INSERT INTO people_groups(name,description) VALUES(?,?)",name,description==null?"":description.strip());
        audit.record(user.id(),"people_group",id,"CREATE",Map.of("name",name));return db.one("SELECT * FROM people_groups WHERE id=?",id);
    }
    @Transactional public Map<String,Object> addTag(String name){
        var user=Access.admin();name=Db.required(name,"标签名称",60);
        long id=db.insert("INSERT INTO tags(name) VALUES(?)",name);
        audit.record(user.id(),"tag",id,"CREATE",Map.of("name",name));return db.one("SELECT * FROM tags WHERE id=?",id);
    }
    @Transactional public Map<String,Object> setTags(long personId,List<Long> ids){
        var user=Access.admin();db.one("SELECT id FROM people WHERE id=? FOR UPDATE",personId);
        if(ids==null || ids.size()>30 || new HashSet<>(ids).size()!=ids.size()) throw new ApiException(400,"单人最多 30 个不同标签");
        for(Long tagId:ids){if(tagId==null) throw new ApiException(400,"标签编号错误");db.one("SELECT id FROM tags WHERE id=?",tagId);}
        db.execute("DELETE FROM people_tag_links WHERE person_id=?",personId);
        for(Long tagId:ids) db.execute("INSERT INTO people_tag_links(person_id,tag_id) VALUES(?,?)",personId,tagId);
        audit.record(user.id(),"person",personId,"SET_TAGS",Map.of("tag_ids",ids));
        return db.one("SELECT p.*,(SELECT STRING_AGG(t.name, ',' ORDER BY t.name) FROM people_tag_links l JOIN tags t ON t.id=l.tag_id WHERE l.person_id=p.id) AS tag_names FROM people p WHERE p.id=?",personId);
    }
    private void checkedWecom(String userid,Long excluding) {
        if(userid==null || userid.isBlank())return;
        if(userid.length()>120)throw new ApiException(400,"企业微信 UserID 过长");
        var existing=excluding==null?db.optional("SELECT id FROM people WHERE wecom_userid=? LIMIT 1",userid):db.optional("SELECT id FROM people WHERE wecom_userid=? AND id<>? LIMIT 1",userid,excluding);
        if(existing!=null)throw new ApiException(409,"企业微信 UserID 已绑定其他人员，请复用同一人员档案下的社交账号");
    }
    private String checkedGroup(String group) {
        String normalized=Db.required(group,"分组",100);
        var row=db.optional("SELECT id FROM people_groups WHERE name=? AND active=TRUE",normalized);
        if(row==null) throw new ApiException(400,"分组尚未创建，请先在分组管理中添加");
        return normalized;
    }
    public List<Map<String,Object>> assignees() { Access.admin(); return db.list("SELECT id,person_no,name,person_type,group_name,wecom_userid FROM people WHERE status='ACTIVE' ORDER BY person_no"); }
    private static String normalizeType(String raw) {
        if(raw==null) return "";
        return switch(raw.trim().toLowerCase(Locale.ROOT)) {
            case "author","作者" -> "author";
            case "creator","素人","创作者","合作创作者" -> "creator";
            case "assistant","助理","官方助理" -> "assistant";
            case "support","客服","授权客服" -> "support";
            default -> raw.trim().toLowerCase(Locale.ROOT);
        };
    }
    @Transactional public Map<String,Object> create(PeopleController.PersonIn input) {
        var actor=Access.admin();
        String personNo=Db.required(input.personNo(),"人员编号",40);
        String name=Db.required(input.name(),"人员名称",120);
        String wecom=input.wecomUserId()==null||input.wecomUserId().isBlank()?null:input.wecomUserId().trim();
        checkedWecom(wecom,null);
        String type=normalizeType(input.personType());
        if(!Set.of("author","creator","assistant","support").contains(type)) throw new ApiException(400,"人员类型无效");
        String idType=input.identityType()==null||input.identityType().isBlank()?"合作账号":Db.required(input.identityType(),"身份类型",40);
        long id=db.insert("INSERT INTO people(person_no,name,person_type,group_name,wecom_userid,identity_type) VALUES(?,?,?,?,?,?)",
            personNo,name,type,checkedGroup(input.groupName()==null||input.groupName().isBlank()?"第一组":input.groupName()),wecom,idType);
        audit.record(actor.id(),"person",id,"CREATE",Map.of("person_no",personNo));
        return db.one("SELECT * FROM people WHERE id=?",id);
    }
    public Map<String,Object> bulkImport(List<PeopleController.PersonIn> rows) {
        var actor=Access.admin();
        if(rows==null||rows.isEmpty()) throw new ApiException(400,"导入名单不能为空");
        if(rows.size()>500) throw new ApiException(400,"单次最多导入 500 条人员记录");
        List<Map<String,Object>> imported=new ArrayList<>();
        List<Map<String,Object>> errors=new ArrayList<>();
        for(int i=0;i<rows.size();i++) {
            int rowNum=i+1;
            var row=rows.get(i);
            String rawNo=row==null||row.personNo()==null?"":row.personNo().trim();
            try {
                Map<String,Object> created=rowTx.execute(status->{
                    if(row==null) throw new ApiException(400,"空行");
                    String personNo=Db.required(row.personNo(),"人员编号",40);
                    String name=Db.required(row.name(),"人员名称",120);
                    String type=normalizeType(row.personType());
                    if(!Set.of("author","creator","assistant","support").contains(type))
                        throw new ApiException(400,"人员类型无效（支持 author/creator/assistant/support 或 作者/素人/官方助理/客服）");
                    String group=checkedGroup(row.groupName()==null||row.groupName().isBlank()?"第一组":row.groupName());
                    String wecom=row.wecomUserId()==null||row.wecomUserId().isBlank()?null:row.wecomUserId().trim();
                    checkedWecom(wecom,null);
                    String idType=row.identityType()==null||row.identityType().isBlank()?"合作账号":Db.required(row.identityType(),"身份类型",40);
                    if(db.optional("SELECT id FROM people WHERE person_no=? LIMIT 1",personNo)!=null)
                        throw new ApiException(409,"人员编号已存在，未覆盖历史档案");
                    long id=db.insert("INSERT INTO people(person_no,name,person_type,group_name,wecom_userid,identity_type) VALUES(?,?,?,?,?,?)",
                        personNo,name,type,group,wecom,idType);
                    return Map.of("row",rowNum,"id",id,"person_no",personNo,"name",name);
                });
                if(created!=null) imported.add(created);
            } catch(ApiException e) {
                errors.add(Map.of("row",rowNum,"person_no",rawNo,"error",e.getMessage()));
            } catch(DataIntegrityViolationException e) {
                errors.add(Map.of("row",rowNum,"person_no",rawNo,"error","人员编号或企业微信 UserID 冲突，未覆盖历史档案"));
            }
        }
        rowTx.executeWithoutResult(status->audit.record(actor.id(),"person",0L,"BULK_IMPORT",
            Map.of("total",rows.size(),"imported",imported.size(),"failed",errors.size())));
        return Map.of("total",rows.size(),"imported_count",imported.size(),"failed_count",errors.size(),"imported",imported,"errors",errors);
    }
    @Transactional public Map<String,Object> update(long id,PeopleController.PersonEdit input) {
        var actor=Access.admin();var previous=db.one("SELECT * FROM people WHERE id=? FOR UPDATE",id);
        if(input.name()!=null) db.execute("UPDATE people SET name=? WHERE id=?",Db.required(input.name(),"名称",120),id);
        if(input.status()!=null) {
            if(!Set.of("ACTIVE","INACTIVE").contains(input.status())) throw new ApiException(400,"状态错误");
            db.execute("UPDATE people SET status=? WHERE id=?",input.status(),id);
            if(input.status().equals("INACTIVE")) {
                db.execute("UPDATE users SET active=FALSE WHERE person_id=?",id);
                db.execute("UPDATE tasks SET status='PAUSED',next_remind_at=NULL WHERE assignee_id=? AND status IN ('PENDING','REWORK')",id);
                db.execute("UPDATE sessions SET revoked=TRUE WHERE user_id IN (SELECT id FROM users WHERE person_id=?)",id);
            }
        }
        if(input.groupName()!=null) db.execute("UPDATE people SET group_name=? WHERE id=?",checkedGroup(input.groupName()),id);
        if(input.wecomUserId()!=null){
            checkedWecom(input.wecomUserId(),id);String next=input.wecomUserId().isBlank()?null:input.wecomUserId();
            db.execute("UPDATE people SET wecom_userid=? WHERE id=?",next,id);
            if(!Objects.equals(next,Db.str(previous.get("wecom_userid"))))
                db.execute("UPDATE sessions SET revoked=TRUE WHERE auth_method='WECOM' AND user_id IN (SELECT id FROM users WHERE person_id=?)",id);
        }
        audit.record(actor.id(),"person",id,"UPDATE",Map.of("changed",true));
        return db.one("SELECT * FROM people WHERE id=?",id);
    }
    @Transactional public Map<String,Object> account(long personId,PeopleController.AccountIn input) {
        var actor=Access.admin();db.one("SELECT id FROM people WHERE id=?",personId);
        Db.required(input.nickname(),"账号昵称",160);Db.required(input.profileUrl(),"主页链接",600);
        String platform=input.platform()==null?"douyin":input.platform().strip();
        if(!"douyin".equals(platform)) throw new ApiException(400,"首版仅支持抖音账号档案");
        String url=Rules.canonicalProfileDouyin(input.profileUrl());
        long id=db.insert("INSERT INTO social_accounts(person_id,platform,nickname,external_uid,profile_url) VALUES(?,?,?,?,?)",
            personId,platform,input.nickname().strip(),input.externalUid(),url);
        audit.record(actor.id(),"social_account",id,"BIND",Map.of("person_id",personId));
        return db.one("SELECT * FROM social_accounts WHERE id=?",id);
    }
    public List<Map<String,Object>> accounts(long personId) { Access.admin();return db.list("SELECT * FROM social_accounts WHERE person_id=? ORDER BY id DESC",personId); }
    @Transactional public Map<String,Object> credentials(long personId,PeopleController.Credentials input) {
        var actor=Access.admin();var p=db.one("SELECT * FROM people WHERE id=?",personId);
        Db.ensure(Db.str(p.get("status")).equals("ACTIVE"),"不能为停用人员创建账号");
        String type=Db.str(p.get("person_type"));
        long id=auth.createUser(input.username(),input.password(),type,personId);
        audit.record(actor.id(),"user",id,"PROVISION",Map.of("person_id",personId));
        return Map.of("id",id,"username",input.username(),"role",type,"person_id",personId);
    }
}
