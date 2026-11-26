package com.socialtask.auth;

import com.socialtask.common.*;
import org.springframework.stereotype.Service;
import java.security.SecureRandom;
import java.time.*;
import java.util.HexFormat;

/** Shared MySQL state store works across API replicas. Each valid state is deleted before contacting WeCom. */
@Service
public class WecomOAuthState {
    private final Db db;
    private final SecureRandom random=new SecureRandom();
    public WecomOAuthState(Db db){this.db=db;}
    public String create(String browserNonce,String next){
        if(!WecomOAuthPolicy.nonce(browserNonce)) throw new ApiException(400,"OAuth 浏览器状态无效");
        byte[] bytes=new byte[32];random.nextBytes(bytes);String state=HexFormat.of().formatHex(bytes);
        var now=Instant.now();
        db.execute("DELETE FROM wecom_oauth_states WHERE expires_at<=?",Db.stamp(now));
        db.execute("INSERT INTO wecom_oauth_states(state_hash,browser_hash,return_path,expires_at) VALUES(?,?,?,?)",
            AuthService.sha256(state),AuthService.sha256(browserNonce),WecomOAuthPolicy.cardPath(next),Db.stamp(now.plusSeconds(300)));
        return state;
    }
    public record Attempt(String next) {}
    public Attempt consume(String state,String browserNonce) {
        if(!WecomOAuthPolicy.nonce(state)||!WecomOAuthPolicy.nonce(browserNonce)) throw invalid();
        String stateHash=AuthService.sha256(state),browserHash=AuthService.sha256(browserNonce);
        var row=db.optional("SELECT return_path FROM wecom_oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>?",stateHash,browserHash,Db.stamp(Instant.now()));
        if(row==null) throw invalid();
        // Atomic compare-and-delete under autocommit: concurrent or replayed requests cannot both win.
        if(db.execute("DELETE FROM wecom_oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>?",stateHash,browserHash,Db.stamp(Instant.now()))!=1) throw invalid();
        return new Attempt(WecomOAuthPolicy.cardPath(Db.str(row.get("return_path"))));
    }
    private ApiException invalid(){return new ApiException(400,"OAuth 状态无效或已过期，请重新授权");}
}
