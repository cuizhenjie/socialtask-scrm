package com.socialtask.notification;

import com.fasterxml.jackson.databind.*;
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
    @Value("${app.wecom.corp-id:}") private String corpId;
    @Value("${app.wecom.secret:}") private String secret;
    @Value("${app.wecom.agent-id:0}") private int agentId;
    @Value("${app.public-url:http://localhost:3000}") private String publicUrl;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
    private final ObjectMapper json=new ObjectMapper();
    private String accessToken;private Instant tokenExpiry=Instant.EPOCH;
    public boolean configured(){return enabled && !corpId.isBlank() && !secret.isBlank() && agentId>0;}
    private synchronized String token() throws Exception {
        if(accessToken!=null && Instant.now().isBefore(tokenExpiry)) return accessToken;
        String query="https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid="+URLEncoder.encode(corpId,StandardCharsets.UTF_8)+"&corpsecret="+URLEncoder.encode(secret,StandardCharsets.UTF_8);
        var response=http.send(HttpRequest.newBuilder(URI.create(query)).timeout(Duration.ofSeconds(6)).GET().build(),HttpResponse.BodyHandlers.ofString());
        if(response.statusCode()!=200) throw new IllegalStateException("企业微信 token HTTP "+response.statusCode());
        JsonNode parsed=json.readTree(response.body());
        if(parsed.path("errcode").asInt(-1)!=0) throw new IllegalStateException("企业微信 token 错误代码 "+parsed.path("errcode").asInt(-1));
        accessToken=parsed.path("access_token").asText();
        tokenExpiry=Instant.now().plusSeconds(Math.max(60,parsed.path("expires_in").asLong(7200)-180));
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
        var req=HttpRequest.newBuilder(URI.create("https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token="+token()))
            .timeout(Duration.ofSeconds(8)).header("Content-Type","application/json;charset=utf-8")
            .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload),StandardCharsets.UTF_8)).build();
        var response=http.send(req,HttpResponse.BodyHandlers.ofString());
        JsonNode result=json.readTree(response.body());
        int code=result.path("errcode").asInt(-1);
        if(response.statusCode()!=200||code!=0) throw new IllegalStateException("企业微信消息接口返回错误代码 "+code);
        if(!result.path("invaliduser").asText("").isBlank()||!result.path("unlicenseduser").asText("").isBlank())
            throw new IllegalStateException("企业微信接收成员无效或不在应用许可范围内");
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
        checkUser(userid);String safe=limited(content,2048);
        if(safe.isBlank()) throw new IllegalArgumentException("企业微信文本消息不能为空");
        return post(Map.of("touser",userid,"msgtype","text","agentid",agentId,"text",Map.of("content",safe)));
    }
}
