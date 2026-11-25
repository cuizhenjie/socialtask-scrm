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
        byte[] bytes=new byte[32]; random.nextBytes(bytes);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        db.execute("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,?)",
            Db.id(user),sha256(token),Db.stamp(Instant.now().plus(Duration.ofHours(12))));
        RequestUser principal=principal(user);
        return Map.of("access_token",token,"token_type","bearer","expires_in",43200,"user",userView(principal));
    }
    public RequestUser authenticate(String token) {
        if(token==null || token.length()<35 || token.length()>150) return null;
        var row=db.optional("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked=FALSE AND s.expires_at>UTC_TIMESTAMP(3) AND u.active=TRUE",sha256(token));
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
