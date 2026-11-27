package com.socialtask.auth;

import com.socialtask.common.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.security.*;
import java.time.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
public class AuthService {
    private final Db db;
    private final BCryptPasswordEncoder encoder=new BCryptPasswordEncoder(12);
    private final SecureRandom random=new SecureRandom();
    public AuthService(Db db) { this.db=db; }

    public static String sha256(String content) {
        try {
            byte[] hashed=MessageDigest.getInstance("SHA-256").digest(content.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hashed);
        } catch(NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    @Transactional
    public Map<String,Object> login(String username,String password) {
        if(username==null || username.isBlank() || password==null || password.isBlank()) throw new ApiException(400,"请输入账号和密码");
        var user=db.optional("SELECT * FROM users WHERE username=?",username);
        if(user==null || !Db.bool(user.get("active")) || !encoder.matches(password,Db.str(user.get("password_hash"))))
            throw new ApiException(401,"用户名或密码错误");
        return issueSession(user,"PASSWORD");
    }
    /** Called only with the UserID returned by the configured enterprise OAuth provider. */
    @Transactional
    public Map<String,Object> loginWecom(String userid) {
        if(userid==null || !userid.matches("[A-Za-z0-9_.@-]{1,64}"))
            throw new ApiException(403,"企业微信身份未获授权");
        // Include inactive and unprovisioned bindings to reject ambiguous mappings, not just the first row.
        var rows=db.list("SELECT u.*,p.status AS person_status,p.wecom_userid AS bound_userid FROM people p LEFT JOIN users u ON u.person_id=p.id WHERE p.wecom_userid=? FOR UPDATE OF p",userid);
        if(rows.size()!=1) throw new ApiException(403,"企业微信身份未获授权");
        var user=rows.getFirst();
        if(user.get("id")==null || !Db.bool(user.get("active")) || !"ACTIVE".equals(user.get("person_status"))
            || !userid.equalsIgnoreCase(Db.str(user.get("bound_userid")))
            || !Set.of("admin","manager","author","creator","assistant","support").contains(Db.str(user.get("role"))))
            throw new ApiException(403,"企业微信身份未获授权");
        return issueSession(user,"WECOM");
    }
    private Map<String,Object> issueSession(Map<String,Object> user,String method) {
        byte[] bytes=new byte[32]; random.nextBytes(bytes);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        db.execute("INSERT INTO sessions(user_id,token_hash,expires_at,auth_method) VALUES(?,?,?,?)",
            Db.id(user),sha256(token),Db.stamp(Instant.now().plus(Duration.ofHours(12))),method);
        RequestUser principal=principal(user);
        return Map.of("access_token",token,"token_type","bearer","expires_in",43200,"user",userView(principal));
    }
    public RequestUser authenticate(String token) {
        if(token==null || token.length()<35 || token.length()>150) return null;
        var row=db.optional("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked=FALSE AND s.expires_at>CURRENT_TIMESTAMP AND u.active=TRUE",sha256(token));
        return row==null?null:principal(row);
    }
    public void logout(String token) {
        if(token!=null && !token.isBlank()) db.execute("UPDATE sessions SET revoked=TRUE WHERE token_hash=?",sha256(token));
    }
    private RequestUser principal(Map<String,Object> row) {
        return new RequestUser(Db.id(row),Db.str(row.get("username")),Db.str(row.get("role")),row.get("person_id")==null?null:Db.l(row.get("person_id")));
    }
    public Map<String,Object> userView(RequestUser user) {
        Map<String,Object> view=new LinkedHashMap<>();
        view.put("id",user.id());view.put("username",user.username());view.put("role",user.role());view.put("person_id",user.personId());
        return view;
    }
    @Transactional
    public long createUser(String username,String password,String role,Long personId) {
        username=Db.required(username,"用户名",80);
        if(password==null || password.length()<12 || password.length()>128) throw new ApiException(400,"密码至少 12 位，至多 128 位");
        if(!Set.of("admin","manager","author","creator","assistant","support").contains(role)) throw new ApiException(400,"角色不合法");
        return db.insert("INSERT INTO users(username,password_hash,role,person_id) VALUES(?,?,?,?)",username,encoder.encode(password),role,personId);
    }
}
