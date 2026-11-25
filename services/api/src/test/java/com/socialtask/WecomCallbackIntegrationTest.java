package com.socialtask;

import com.socialtask.wecom.WecomCrypto;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.*;
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
 @Test void signedAppCallbackPersistsAndDeduplicates()throws Exception{
    var crypto=new WecomCrypto("testcallbacktoken","AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA","ww-test-corp");
    byte[] nonce16=new byte[16];Arrays.fill(nonce16,(byte)42);
    String ts=Long.toString(java.time.Instant.now().getEpochSecond()),nonce="testnonce";
    String echo=crypto.encryptForTest("hello-wecom",nonce16),sig=crypto.signature(ts,nonce,echo);
    MvcResult verified=mvc.perform(get("/api/v1/wecom/callback").param("msg_signature",sig).param("timestamp",ts).param("nonce",nonce).param("echostr",echo)).andReturn();
    assertEquals(200,verified.getResponse().getStatus());assertEquals("hello-wecom",verified.getResponse().getContentAsString());
    var invalid=mvc.perform(get("/api/v1/wecom/callback").param("msg_signature","bad").param("timestamp",ts).param("nonce",nonce).param("echostr",echo)).andReturn();
    assertEquals(403,invalid.getResponse().getStatus());
    String uid="internal_"+UUID.randomUUID().toString().substring(0,8);
    String payload="<xml><ToUserName><![CDATA[ww-test-corp]]></ToUserName><FromUserName><![CDATA["+uid+"]]></FromUserName><CreateTime>"+ts+"</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[协助创建工单]]></Content><MsgId>"+UUID.randomUUID()+"</MsgId></xml>";
    String encrypted=crypto.encryptForTest(payload,nonce16),signature=crypto.signature(ts,nonce,encrypted);
    String outer="<xml><Encrypt><![CDATA["+encrypted+"]]></Encrypt></xml>";
    for(int i=0;i<2;i++){
       MvcResult result=mvc.perform(post("/api/v1/wecom/callback").param("msg_signature",signature).param("timestamp",ts).param("nonce",nonce).contentType(MediaType.TEXT_XML).content(outer)).andReturn();
       assertEquals(200,result.getResponse().getStatus());
    }
    MvcResult login=mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("username","ci-admin","password","This-Is-A-Test-Only-Password-123")))).andReturn();
    String token=json.readTree(login.getResponse().getContentAsString()).get("access_token").asText();
    MvcResult threads=mvc.perform(get("/api/v1/wecom/inbox/conversations").header("Authorization","Bearer "+token)).andReturn();
    assertEquals(200,threads.getResponse().getStatus());
    long id=0;for(JsonNode t:json.readTree(threads.getResponse().getContentAsString()))if(uid.equals(t.get("peer_userid").asText()))id=t.get("id").asLong();
    assertTrue(id>0);
    MvcResult msgs=mvc.perform(get("/api/v1/wecom/inbox/conversations/"+id+"/messages").header("Authorization","Bearer "+token)).andReturn();
    JsonNode messageList=json.readTree(msgs.getResponse().getContentAsString());
    assertEquals(1,messageList.size(),"Repeated signed callback must not duplicate a message");
 }
}
