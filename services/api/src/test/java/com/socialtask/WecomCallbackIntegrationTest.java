package com.socialtask;

import com.socialtask.wecom.WecomCrypto;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.*;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Fully offline signed callback simulation; does not imply real enterprise account connectivity. */
@SpringBootTest(properties={
 "app.wecom.callback-enabled=true",
 "app.wecom.callback-token=testcallbacktoken",
 "app.wecom.encoding-aes-key=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
 "app.wecom.corp-id=ww-test-corp"
})
@AutoConfigureMockMvc
class WecomCallbackIntegrationTest {
 @Autowired MockMvc mvc;@Autowired ObjectMapper json;
 @Test void signedAppCallbackPersistsDeduplicatesAndLinksToAnOwnedServiceTicket()throws Exception{
    var crypto=new WecomCrypto("testcallbacktoken","AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA","ww-test-corp");
    byte[] nonce16=new byte[16];Arrays.fill(nonce16,(byte)42);
    String ts=Long.toString(java.time.Instant.now().getEpochSecond()),nonce="testnonce";
    String echo=crypto.encryptForTest("hello-wecom",nonce16),sig=crypto.signature(ts,nonce,echo);
    MvcResult verified=mvc.perform(get("/api/v1/wecom/callback").param("msg_signature",sig).param("timestamp",ts).param("nonce",nonce).param("echostr",echo)).andReturn();
    assertEquals(200,verified.getResponse().getStatus());assertEquals("hello-wecom",verified.getResponse().getContentAsString());
    var invalid=mvc.perform(get("/api/v1/wecom/callback").param("msg_signature","bad").param("timestamp",ts).param("nonce",nonce).param("echostr",echo)).andReturn();
    assertEquals(403,invalid.getResponse().getStatus());
    String token=login("ci-admin","This-Is-A-Test-Only-Password-123");
    String suffix=UUID.randomUUID().toString().substring(0,8);
    String uid="internal_"+suffix, worker="wc-"+suffix, password="Testing-Pass-2026!";
    long assignee=postJson("/api/v1/people",token,Map.of(
         "personNo","WC"+suffix,"name","模拟企微客服"+suffix,"personType","support","wecomUserId",uid)).path("id").asLong();
    assertTrue(assignee>0);
    postJson("/api/v1/people/"+assignee+"/credentials",token,Map.of("username",worker,"password",password));
    String payload="<xml><ToUserName><![CDATA[ww-test-corp]]></ToUserName><FromUserName><![CDATA["+uid+"]]></FromUserName><CreateTime>"+ts+"</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[协助创建工单]]></Content><MsgId>"+UUID.randomUUID()+"</MsgId></xml>";
    String encrypted=crypto.encryptForTest(payload,nonce16),signature=crypto.signature(ts,nonce,encrypted);
    String outer="<xml><Encrypt><![CDATA["+encrypted+"]]></Encrypt></xml>";
    for(int i=0;i<2;i++){
       MvcResult result=mvc.perform(post("/api/v1/wecom/callback").param("msg_signature",signature).param("timestamp",ts).param("nonce",nonce).contentType(MediaType.TEXT_XML).content(outer)).andReturn();
       assertEquals(200,result.getResponse().getStatus());
    }
    MvcResult threads=mvc.perform(get("/api/v1/wecom/inbox/conversations").header("Authorization","Bearer "+token)).andReturn();
    assertEquals(200,threads.getResponse().getStatus());
    long id=0;
    for(JsonNode thread:json.readTree(threads.getResponse().getContentAsString())){
       if(uid.equals(thread.path("peer_userid").asText())){
          id=thread.path("id").asLong();
          assertEquals(assignee,thread.path("person_id").asLong());
          assertEquals(1,thread.path("unread_count").asInt());
       }
    }
    assertTrue(id>0);
    MvcResult msgs=mvc.perform(get("/api/v1/wecom/inbox/conversations/"+id+"/messages").header("Authorization","Bearer "+token)).andReturn();
    assertEquals(200,msgs.getResponse().getStatus());
    JsonNode messageList=json.readTree(msgs.getResponse().getContentAsString());
    assertEquals(1,messageList.size(),"Repeated signed callback must not duplicate a message");
    JsonNode inboxMessage=messageList.get(0);
    assertEquals("INBOUND",inboxMessage.path("direction").asText());
    assertEquals("协助创建工单",inboxMessage.path("content").asText());
    long source=inboxMessage.path("id").asLong();
    JsonNode ticket=postJson("/api/v1/tickets",token,Map.of("title","消息来源工单","description","协助创建工单",
        "assigneeId",assignee,"deadline",Instant.now().plusSeconds(3600).toString(),"sourceMessageId",source));
    long ticketId=ticket.path("id").asLong();
    assertTrue(ticketId>0);
    assertEquals("SERVICE_TICKET",ticket.path("type").asText());
    assertEquals(source,ticket.path("source_message_id").asLong());

    String workerToken=login(worker,password);
    MvcResult detail=mvc.perform(get("/api/v1/tasks/"+ticketId).header("Authorization","Bearer "+workerToken)).andReturn();
    assertEquals(200,detail.getResponse().getStatus(),detail.getResponse().getContentAsString());
    assertEquals(ticketId,json.readTree(detail.getResponse().getContentAsString()).path("id").asLong());
    MvcResult inboxForbidden=mvc.perform(get("/api/v1/wecom/inbox/conversations").header("Authorization","Bearer "+workerToken)).andReturn();
    assertEquals(403,inboxForbidden.getResponse().getStatus());
 }
 private String login(String username,String password)throws Exception{
    MvcResult result=mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
        .content(json.writeValueAsString(Map.of("username",username,"password",password)))).andReturn();
    assertEquals(200,result.getResponse().getStatus(),result.getResponse().getContentAsString());
    return json.readTree(result.getResponse().getContentAsString()).path("access_token").asText();
 }
 private JsonNode postJson(String route,String token,Object payload)throws Exception{
    MvcResult result=mvc.perform(post(route).header("Authorization","Bearer "+token)
        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(payload))).andReturn();
    assertEquals(200,result.getResponse().getStatus(),result.getResponse().getContentAsString());
    return json.readTree(result.getResponse().getContentAsString());

 }
}
