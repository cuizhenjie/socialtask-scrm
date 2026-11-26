package com.socialtask.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.socialtask.common.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.net.http.*;
import java.time.*;

import static com.socialtask.auth.WecomOAuthPolicy.*;

/** Dedicated identity adapter: enabling OAuth must not enable notification sending. */
@Component
public class WecomOAuthClient {
    @FunctionalInterface interface Transport { String get(URI uri) throws Exception; }
    private final boolean enabled;
    private final String corpId,secret,publicUrl;
    private final int agentId;
    private final ObjectMapper json;
    private final Transport transport;
    private String cachedToken;
    private Instant expiry=Instant.EPOCH;
    @Autowired
    public WecomOAuthClient(@Value("${app.wecom.oauth-enabled:false}") boolean enabled,
        @Value("${app.wecom.corp-id:}") String corpId,@Value("${app.wecom.agent-id:0}") int agentId,
        @Value("${app.wecom.secret:}") String secret,@Value("${app.public-url:http://localhost:3000}") String publicUrl,
        ObjectMapper json) {
        this(enabled,corpId,agentId,secret,publicUrl,json,httpsTransport());
    }
    WecomOAuthClient(boolean enabled,String corpId,int agentId,String secret,String publicUrl,ObjectMapper json,Transport transport) {
        this.enabled=enabled;this.corpId=corpId;this.agentId=agentId;this.secret=secret;this.publicUrl=publicUrl;this.json=json;this.transport=transport;
    }
    private static Transport httpsTransport() {
        var http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).followRedirects(HttpClient.Redirect.NEVER).build();
        return uri->{
            var r=http.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(6)).GET().build(),HttpResponse.BodyHandlers.ofString());
            if(r.statusCode()!=200) throw new IllegalStateException("OAuth upstream HTTP failure");
            return r.body();
        };
    }
    void requireConfigured() {
        if(!enabled) throw new ApiException(404,"企业微信登录未启用");
        if(corpId.isBlank()||secret.isBlank()||agentId<=0) throw new ApiException(503,"企业微信登录配置不完整");
        try { callback(publicUrl); } catch(IllegalArgumentException e) { throw new ApiException(503,"企业微信登录需要 HTTPS 公网地址"); }
    }
    String authorization(String state) {
        requireConfigured();return authorizeUrl(corpId,agentId,callback(publicUrl),state);
    }
    private JsonNode get(String path) throws Exception {
        return json.readTree(transport.get(URI.create("https://qyapi.weixin.qq.com/cgi-bin/"+path)));
    }
    private synchronized String token() throws Exception {
        if(cachedToken!=null && Instant.now().isBefore(expiry)) return cachedToken;
        var data=get("gettoken?corpid="+enc(corpId)+"&corpsecret="+enc(secret));
        if(data.path("errcode").asInt(-1)!=0 || !data.path("access_token").isTextual() || data.path("access_token").asText().isBlank())
            throw new IllegalStateException("OAuth token rejected");
        cachedToken=data.path("access_token").asText();
        expiry=Instant.now().plusSeconds(Math.max(0,data.path("expires_in").asLong(0)-180));
        return cachedToken;
    }
    private synchronized void invalidate(String usedToken) { if(usedToken.equals(cachedToken)){cachedToken=null;expiry=Instant.EPOCH;} }
    String userId(String authorizationCode) {
        requireConfigured();
        if(!code(authorizationCode)) throw new ApiException(400,"授权码无效");
        try {
            String used=token();
            var data=get("auth/getuserinfo?access_token="+enc(used)+"&code="+enc(authorizationCode));
            int error=data.path("errcode").asInt(-1);
            // Do not retry a one-time authorization code; a new authorization is required.
            if(error==40014||error==42001) invalidate(used);
            if(error!=0) throw new ApiException(401,"企业微信授权失败，请重新授权");
            if(!data.path("userid").isTextual() || !data.path("userid").asText().matches("[A-Za-z0-9_.@-]{1,64}"))
                throw new ApiException(403,"企业微信身份未获授权");
            return data.path("userid").asText();
        } catch(ApiException e) { throw e; }
        catch(InterruptedException e) { Thread.currentThread().interrupt();throw new ApiException(502,"企业微信授权服务暂不可用"); }
        catch(Exception e) { throw new ApiException(502,"企业微信授权服务暂不可用"); }
    }
}
