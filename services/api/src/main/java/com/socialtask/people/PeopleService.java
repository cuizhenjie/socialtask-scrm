package com.socialtask.people;

import com.socialtask.auth.AuthService;
import com.socialtask.common.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service
public class PeopleService {
    private final Db db; private final Audit audit; private final AuthService auth;
    public PeopleService(Db db,Audit audit,AuthService auth){this.db=db;this.audit=audit;this.auth=auth;}

    public List<Map<String,Object>> list(String q,String role,String group,String status,Long tagId) {
        Access.admin();
        StringBuilder sql=new StringBuilder("SELECT p.*, (SELECT GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ',') FROM people_tag_links l JOIN tags t ON t.id=l.tag_id WHERE l.person_id=p.id) AS tag_names, (SELECT GROUP_CONCAT(l.tag_id ORDER BY l.tag_id SEPARATOR ',') FROM people_tag_links l WHERE l.person_id=p.id) AS tag_ids FROM people p WHERE 1=1");
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
        return db.one("SELECT p.*,(SELECT GROUP_CONCAT(t.name ORDER BY t.name) FROM people_tag_links l JOIN tags t ON t.id=l.tag_id WHERE l.person_id=p.id) AS tag_names FROM people p WHERE p.id=?",personId);
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
    @Transactional public Map<String,Object> create(PeopleController.PersonIn input) {
        var actor=Access.admin();
        Db.required(input.personNo(),"人员编号",40);Db.required(input.name(),"人员名称",120);checkedWecom(input.wecomUserId(),null);
        if(!Set.of("author","creator","assistant","support").contains(input.personType())) throw new ApiException(400,"人员类型无效");
        long id=db.insert("INSERT INTO people(person_no,name,person_type,group_name,wecom_userid,identity_type) VALUES(?,?,?,?,?,?)",
            input.personNo().trim(),input.name().trim(),input.personType(),checkedGroup(input.groupName()==null?"第一组":input.groupName()),input.wecomUserId(),input.identityType()==null?"合作账号":input.identityType());
        audit.record(actor.id(),"person",id,"CREATE",Map.of("person_no",input.personNo()));
        return db.one("SELECT * FROM people WHERE id=?",id);
    }
    @Transactional public Map<String,Object> update(long id,PeopleController.PersonEdit input) {
        var actor=Access.admin();db.one("SELECT * FROM people WHERE id=? FOR UPDATE",id);
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
        if(input.wecomUserId()!=null){checkedWecom(input.wecomUserId(),id);db.execute("UPDATE people SET wecom_userid=? WHERE id=?",input.wecomUserId().isBlank()?null:input.wecomUserId(),id);}
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
