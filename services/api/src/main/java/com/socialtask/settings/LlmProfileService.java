package com.socialtask.settings;

import com.socialtask.common.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service
public class LlmProfileService {
    private final Db db;private final Audit audit;private final SecretBox box;private final ModelEndpoint endpoint;
    public LlmProfileService(Db db,Audit audit,@Value("${app.settings.master-key:}") String master,@Value("${app.settings.llm-allowed-origins:}") String allowed){this.db=db;this.audit=audit;this.box=new SecretBox(master);this.endpoint=new ModelEndpoint(allowed);}
    public record Input(Integer expectedVersion,Boolean enabled,String url,Boolean baseUrl,String model,String apiKey,Boolean clearKey){@Override public String toString(){return "LlmProfileInput[redacted]";}}
    static void admin(){if(!"admin".equals(Access.who().role()))throw new ApiException(403,"仅系统管理员可管理模型配置");}
    private static String aad(int version){return "socialtask:llm:profile:"+version;}
    private Map<String,Object> row(){return db.optional("SELECT * FROM llm_profile WHERE id=1");}
    public Map<String,Object> view(){admin();return view(row());}
    private Map<String,Object> view(Map<String,Object> row){
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("version",row==null?0:Db.n(row.get("version")));result.put("enabled",row!=null&&Db.bool(row.get("enabled")));
        result.put("endpoint",row==null?"":Db.str(row.get("endpoint")));result.put("model",row==null?"":Db.str(row.get("model_id")));
        result.put("key_configured",row!=null&&row.get("key_cipher")!=null);result.put("storage_ready",box.ready());
        result.put("allowed_origin_count",endpoint.count());result.put("connection_tested",false);
        if(row!=null)result.put("updated_at",row.get("updated_at"));
        return result;
    }
    @Transactional public Map<String,Object> save(Input input){
        admin();if(!box.ready()||endpoint.count()==0)throw new ApiException(503,"须先由部署管理员配置主密钥及 HTTPS 模型服务允许名单");
        Db.badIf(input==null||input.expectedVersion()==null||input.expectedVersion()<0||input.expectedVersion()==Integer.MAX_VALUE||input.enabled()==null,"缺少版本或启用状态");
        String target=endpoint.endpoint(input.url(),Boolean.TRUE.equals(input.baseUrl()));
        String model=Db.required(input.model(),"模型 ID",160);Db.badIf(model.chars().anyMatch(Character::isISOControl),"模型 ID 含非法控制字符");
        boolean clear=Boolean.TRUE.equals(input.clearKey());String supplied=input.apiKey();
        Db.badIf(clear&&supplied!=null&&!supplied.isEmpty(),"不能同时清除和替换密钥");
        if(supplied!=null&&!supplied.isEmpty())Db.badIf(supplied.length()>2048||!supplied.matches("[\\x21-\\x7e]+"),"API Key 含非法字符或过长");
        var old=db.optional("SELECT * FROM llm_profile WHERE id=1 FOR UPDATE");
        int version=old==null?0:Db.n(old.get("version"));Db.ensure(version==input.expectedVersion(),"配置版本已变化，请刷新后重试");
        int next=version+1;
        String key=null;
        if(!clear){
            if(supplied!=null&&!supplied.isEmpty())key=supplied;
            else if(old!=null&&old.get("key_cipher")!=null)key=box.decrypt(Db.str(old.get("key_cipher")),aad(version));
        }
        Db.badIf(Boolean.TRUE.equals(input.enabled())&&key==null,"启用模型前须设置 API Key");
        // Never reuse a saved key across a different endpoint without explicit re-entry.
        if(old!=null&&!Objects.equals(old.get("endpoint"),target)&&key!=null&&(supplied==null||supplied.isEmpty()))throw new ApiException(400,"更改模型地址时须重新输入 API Key 或显式清除");
        String cipher=key==null?null:box.encrypt(key,aad(next));
        long actor=Access.who().id();
        try{
            if(old==null)db.execute("INSERT INTO llm_profile(id,version,enabled,endpoint,model_id,key_cipher,updated_by) VALUES(1,?,?,?,?,?,?)",next,input.enabled(),target,model,cipher,actor);
            else db.execute("UPDATE llm_profile SET version=?,enabled=?,endpoint=?,model_id=?,key_cipher=?,updated_by=? WHERE id=1",next,input.enabled(),target,model,cipher,actor);
        }catch(DuplicateKeyException e){throw new ApiException(409,"配置版本已变化，请刷新后重试");}
        audit.record(actor,"llm_profile",1,"UPDATE",Map.of("version",next,"enabled",input.enabled(),"key_changed",clear||supplied!=null&&!supplied.isEmpty()));
        return view(db.one("SELECT * FROM llm_profile WHERE id=1"));
    }
    record Active(String endpoint,String model,String key){@Override public String toString(){return "LlmProfileActive[redacted]";}}
    Active active(){
        admin();var row=row();
        if(row==null||!Db.bool(row.get("enabled"))||row.get("key_cipher")==null)throw new ApiException(409,"服务端模型尚未启用");
        String target=endpoint.endpoint(Db.str(row.get("endpoint")),false);
        return new Active(target,Db.str(row.get("model_id")),box.decrypt(Db.str(row.get("key_cipher")),aad(Db.n(row.get("version")))));
    }
}
