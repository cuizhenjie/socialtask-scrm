package com.socialtask.kf;

import com.fasterxml.jackson.databind.*;
import com.socialtask.auth.AuthService;
import com.socialtask.common.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;

@Component
public class KfSyncClient {
    @FunctionalInterface interface Transport {String request(URI uri,String body)throws Exception;}
    private final boolean enabled,authorized;
    private final String corp,account,secret,appSecret;
    private final int retentionDays;
    private final ObjectMapper json;
    private final Transport transport;
    private String token;private Instant expires=Instant.EPOCH;
    @Autowired
    public KfSyncClient(@Value("${app.wecom.kf-enabled:false}") boolean enabled,@Value("${app.wecom.kf-authorized:false}") boolean authorized,
        @Value("${app.wecom.corp-id:}") String corp,@Value("${app.wecom.kf-account-id:}") String account,
        @Value("${app.wecom.kf-secret:}") String secret,@Value("${app.wecom.secret:}") String appSecret,
        @Value("${app.wecom.kf-retention-days:30}") int retentionDays,ObjectMapper json){
        this(enabled,authorized,corp,account,secret,appSecret,retentionDays,json,httpTransport());
    }
    KfSyncClient(boolean enabled,boolean authorized,String corp,String account,String secret,String appSecret,int retentionDays,ObjectMapper json,Transport transport){
        this.enabled=enabled;this.authorized=authorized;this.corp=corp;this.account=account;this.secret=secret;this.appSecret=appSecret;this.retentionDays=retentionDays;this.json=json;this.transport=transport;
    }
    public boolean enabled(){return enabled;}
    public boolean authorized(){return authorized;}
    public int retentionDays(){return retentionDays;}
    public boolean configured(){return enabled&&authorized&&!corp.isBlank()&&account.matches("wk[A-Za-z0-9_-]{1,126}")&&!secret.isBlank()&&!secret.equals(appSecret)&&retentionDays>=1&&retentionDays<=90;}
    public String accountKey(){return AuthService.sha256("KF_ACCOUNT:"+corp+":"+account);}
    private static String enc(String s){return URLEncoder.encode(s,StandardCharsets.UTF_8);}
    private static Transport httpTransport(){
        var http=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(Duration.ofSeconds(4)).build();
        return (uri,body)->{
            var builder=HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(12));
            if(body==null)builder.GET();else builder.header("Content-Type","application/json;charset=utf-8").POST(HttpRequest.BodyPublishers.ofString(body));
            var future=http.sendAsync(builder.build(),info->bounded());
            HttpResponse<byte[]> response;
            try{response=future.get(15,TimeUnit.SECONDS);}catch(Exception e){future.cancel(true);throw e;}
            if(response.statusCode()!=200)throw new IOException("微信客服 HTTP 响应异常");
            return new String(response.body(),StandardCharsets.UTF_8);
        };
    }
    private static HttpResponse.BodySubscriber<byte[]> bounded(){
        return new HttpResponse.BodySubscriber<byte[]>(){
            private final CompletableFuture<byte[]> result=new CompletableFuture<>();
            private final ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            private Flow.Subscription subscription;
            public CompletionStage<byte[]> getBody(){return result;}
            public void onSubscribe(Flow.Subscription s){subscription=s;s.request(1);}
            public void onNext(List<ByteBuffer> parts){
                for(var part:parts){if(part.remaining()>2*1024*1024-bytes.size()){subscription.cancel();result.completeExceptionally(new IOException("微信客服响应过大"));return;}
                    byte[] b=new byte[part.remaining()];part.get(b);bytes.writeBytes(b);}
                subscription.request(1);
            }
            public void onError(Throwable t){result.completeExceptionally(t);}
            public void onComplete(){result.complete(bytes.toByteArray());}
        };
    }
    private synchronized String token()throws Exception{
        if(token!=null&&Instant.now().isBefore(expires))return token;
        var r=json.readTree(transport.request(URI.create("https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid="+enc(corp)+"&corpsecret="+enc(secret)),null));
        if(r.path("errcode").asInt(-1)!=0||!r.path("access_token").isTextual()||r.path("access_token").asText().isBlank())throw new IOException("微信客服凭证无效");
        token=r.path("access_token").asText();expires=Instant.now().plusSeconds(Math.max(0,r.path("expires_in").asLong(0)-180));return token;
    }
    private synchronized void invalidate(String used){if(used.equals(token)){token=null;expires=Instant.EPOCH;}}
    public KfPage fetch(String cursor){
        if(!configured())throw new ApiException(409,"微信客服未启用或未完成独立授权配置");
        if(cursor==null||cursor.length()>1024||cursor.chars().anyMatch(Character::isISOControl))throw new ApiException(400,"微信客服游标无效");
        try{
            Map<String,Object> body=new LinkedHashMap<>();body.put("open_kfid",account);body.put("limit",100);body.put("voice_format",0);if(!cursor.isBlank())body.put("cursor",cursor);
            String used=token();
            JsonNode page=json.readTree(transport.request(URI.create("https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token="+enc(used)),json.writeValueAsString(body)));
            int code=page.path("errcode").asInt(-1);if(code==40014||code==42001)invalidate(used);
            return KfPage.parse(page,account,accountKey(),cursor);
        }catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();throw new ApiException(502,"微信客服同步失败；游标未推进，请核对许可与接口频率限制");}
    }
}
