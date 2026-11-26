package com.socialtask.notification;

import com.fasterxml.jackson.databind.*;
import com.socialtask.wecom.WecomMediaPolicy;
import java.io.*;
import java.nio.ByteBuffer;
import java.util.concurrent.*;
import java.util.concurrent.Flow;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;

/** Enterprise WeChat self-built application outbound adapter. API acceptance != human delivery/read receipt. */
@Component
public class WecomGateway {
    @Value("${app.wecom.enabled:false}") private boolean enabled;
    @Value("${app.wecom.media-enabled:false}") private boolean mediaEnabled;
    @Value("${app.wecom.corp-id:}") private String corpId;
    @Value("${app.wecom.secret:}") private String secret;
    @Value("${app.wecom.agent-id:0}") private int agentId;
    @Value("${app.public-url:http://localhost:3000}") private String publicUrl;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final ObjectMapper json=new ObjectMapper();
    private String accessToken;private Instant tokenExpiry=Instant.EPOCH;
    public boolean configured(){return enabled && !corpId.isBlank() && !secret.isBlank() && agentId>0;}
    public boolean mediaConfigured(){return mediaEnabled&&corpId!=null&&!corpId.isBlank()&&secret!=null&&!secret.isBlank()&&agentId>0;}
    public static class Rejected extends Exception {public Rejected(){super("企业微信明确拒绝请求");}}
    private static String enc(String value){return URLEncoder.encode(value,StandardCharsets.UTF_8);}
    private synchronized void invalidateToken(){accessToken=null;tokenExpiry=Instant.EPOCH;}
    private synchronized String token() throws Exception {
        if(accessToken!=null && Instant.now().isBefore(tokenExpiry)) return accessToken;
        String query="https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid="+URLEncoder.encode(corpId,StandardCharsets.UTF_8)+"&corpsecret="+URLEncoder.encode(secret,StandardCharsets.UTF_8);
        var response=http.send(HttpRequest.newBuilder(URI.create(query)).timeout(Duration.ofSeconds(6)).GET().build(),HttpResponse.BodyHandlers.ofString());
        if(response.statusCode()!=200) throw new IllegalStateException("企业微信 token HTTP "+response.statusCode());
        JsonNode parsed=json.readTree(response.body());
        if(parsed.path("errcode").asInt(-1)!=0)throw new Rejected();
        if(!parsed.path("access_token").isTextual()||parsed.path("access_token").asText().isBlank())throw new IllegalStateException("企业微信凭证响应无效");
        accessToken=parsed.path("access_token").asText();
        tokenExpiry=Instant.now().plusSeconds(Math.max(0,parsed.path("expires_in").asLong(7200)-180));
        return accessToken;
    }
    private static String limited(String input,int maxBytes){
        String s=input==null?"":input;StringBuilder out=new StringBuilder();int bytes=0;
        for(int pos=0;pos<s.length();){int cp=s.codePointAt(pos);String part=new String(Character.toChars(cp));int size=part.getBytes(StandardCharsets.UTF_8).length;
            if(bytes+size>maxBytes)break;out.append(part);bytes+=size;pos+=Character.charCount(cp);}
        return out.toString();
    }
    private static String escape(String input){return input.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;");}
    private static void checkUser(String user){
        if(user==null||!user.matches("[A-Za-z0-9_.@-]{1,128}")) throw new IllegalArgumentException("企业微信 UserID 格式不合法");
    }
    private String post(Map<String,Object> payload)throws Exception{
        if(!configured()) throw new IllegalStateException("企业微信自建应用未完成出站配置");
        var req=HttpRequest.newBuilder(URI.create("https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token="+enc(token())))
            .timeout(Duration.ofSeconds(8)).header("Content-Type","application/json;charset=utf-8")
            .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload),StandardCharsets.UTF_8)).build();
        var response=http.send(req,HttpResponse.BodyHandlers.ofString());
        JsonNode result=json.readTree(response.body());
        int code=result.path("errcode").asInt(-1);
        if(response.statusCode()!=200||!result.path("errcode").isIntegralNumber())throw new IllegalStateException("企业微信响应异常");
        if(code==40014||code==42001)invalidateToken();
        if(code!=0)throw new Rejected();
        if(!result.path("invaliduser").asText("").isBlank()||!result.path("unlicenseduser").asText("").isBlank())
            throw new Rejected();
        return result.path("msgid").asText("");
    }
    public String sendTextCard(String userid,String title,String description,Long taskId)throws Exception{
        checkUser(userid);
        String link=publicUrl.replaceAll("/+$","")+(taskId==null?"/m":"/m/tasks/"+taskId);
        String safeTitle=limited(escape(title==null?"SocialTask 工单通知":title),128);
        String safeDescription=limited(escape(description==null?"请打开任务中心处理":description),512);
        return post(Map.of("touser",userid,"msgtype","textcard","agentid",agentId,
            "textcard",Map.of("title",safeTitle,"description",safeDescription,"url",link,"btntxt","查看"),"enable_duplicate_check",1));
    }
    public String sendText(String userid,String content)throws Exception{
        checkUser(userid);String safe=content;
        if(safe==null||safe.isBlank()||safe.getBytes(StandardCharsets.UTF_8).length>2048)throw new IllegalArgumentException("企业微信文本须为 1–2048 UTF-8 字节");
        return post(Map.of("touser",userid,"msgtype","text","agentid",agentId,"text",Map.of("content",safe)));
    }

    public String sendMedia(String userid,WecomMediaPolicy.Upload upload)throws Exception{
        checkUser(userid);if(!configured()||!mediaConfigured())throw new IllegalStateException("企业微信媒体发送未启用");
        String boundary="SocialTask"+UUID.randomUUID().toString().replace("-","");
        byte[] begin=("--"+boundary+"\r\nContent-Disposition: form-data; name=\"media\"; filename=\""+upload.filename()+"\"; filelength="+upload.bytes().length+"\r\nContent-Type: "+upload.mime()+"\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
        byte[] end=("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.US_ASCII);
        var req=HttpRequest.newBuilder(URI.create("https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token="+enc(token())+"&type="+upload.type()))
            .timeout(Duration.ofSeconds(20)).header("Content-Type","multipart/form-data; boundary="+boundary)
            .POST(HttpRequest.BodyPublishers.ofByteArrays(List.of(begin,upload.bytes(),end))).build();
        var response=http.send(req,HttpResponse.BodyHandlers.ofString());
        if(response.statusCode()!=200)throw new IllegalStateException("企业微信媒体响应异常");
        JsonNode result=json.readTree(response.body());
        if(!result.path("errcode").isIntegralNumber())throw new IllegalStateException("企业微信媒体响应无效");
        int code=result.path("errcode").asInt();if(code==40014||code==42001)invalidateToken();if(code!=0)throw new Rejected();
        String media=result.path("media_id").asText("");
        if(!WecomMediaPolicy.validMediaId(media))throw new IllegalStateException("企业微信媒体响应无效");
        return post(Map.of("touser",userid,"msgtype",upload.type(),"agentid",agentId,upload.type(),Map.of("media_id",media)));
    }
    private static HttpResponse.BodySubscriber<byte[]> bounded(int max){
        return new HttpResponse.BodySubscriber<byte[]>(){
            private final CompletableFuture<byte[]> result=new CompletableFuture<>();
            private final ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            private Flow.Subscription subscription;
            public CompletionStage<byte[]> getBody(){return result;}
            public void onSubscribe(Flow.Subscription s){subscription=s;s.request(1);}
            public void onNext(List<ByteBuffer> parts){
                for(var part:parts){if(part.remaining()>max-bytes.size()){subscription.cancel();result.completeExceptionally(new IOException("媒体超过大小上限"));return;}
                    byte[] b=new byte[part.remaining()];part.get(b);bytes.writeBytes(b);}
                subscription.request(1);
            }
            public void onError(Throwable t){result.completeExceptionally(t);}
            public void onComplete(){result.complete(bytes.toByteArray());}
        };
    }
    public byte[] downloadMedia(String mediaId)throws Exception{
        if(!mediaConfigured()||!WecomMediaPolicy.validMediaId(mediaId))throw new IllegalArgumentException("媒体下载未启用或媒体标识无效");
        var req=HttpRequest.newBuilder(URI.create("https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token="+enc(token())+"&media_id="+enc(mediaId))).timeout(Duration.ofSeconds(20)).GET().build();
        var pending=http.sendAsync(req,info->bounded(WecomMediaPolicy.MAX_BYTES));
        HttpResponse<byte[]> response;
        try{response=pending.get(25,TimeUnit.SECONDS);}catch(Exception e){pending.cancel(true);throw e;}
        byte[] bytes=response.body();
        if(response.statusCode()!=200||bytes.length==0)throw new IllegalStateException("媒体暂不可用");
        String mime=response.headers().firstValue("Content-Type").orElse("").toLowerCase(Locale.ROOT);
        if(mime.contains("json")||bytes[0]=='{')throw new IllegalStateException("媒体已失效或无访问权限");
        return bytes;
    }
}
