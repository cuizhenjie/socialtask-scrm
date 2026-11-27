package com.socialtask;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Runs in CI against the real MySQL 8.4 service with Flyway V1 migration. */
@EnabledIfEnvironmentVariable(named = "SUPABASE_URL", matches = ".+")
@SpringBootTest
@AutoConfigureMockMvc
class WorkflowIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  private String token;
  private String login(String name,String password)throws Exception{
    JsonNode r=body(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("username",name,"password",password))),200);
    return r.get("access_token").asText();
  }
  private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder builder){return builder.header("Authorization","Bearer "+token);}
  private JsonNode body(MockHttpServletRequestBuilder request,int status)throws Exception {
    MvcResult response=mvc.perform(request).andReturn();
    assertEquals(status,response.getResponse().getStatus(),response.getResponse().getContentAsString());
    return json.readTree(response.getResponse().getContentAsString());
  }
  private JsonNode postJson(String url,Object data,int status)throws Exception{
    return body(auth(post(url)).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(data)),status);
  }
  private JsonNode getJson(String url,int status)throws Exception{return body(auth(get(url)),status);}
  private long person(String no,String name,String type,String group)throws Exception {
    return postJson("/api/v1/people",Map.of("personNo",no,"name",name,"personType",type,"groupName",group),200).get("id").asLong();
  }
  private void credential(long id,String username)throws Exception{
    postJson("/api/v1/people/"+id+"/credentials",Map.of("username",username,"password","Testing-Pass-2026!"),200);
  }
  @Test void fullBusinessLoopAndAccessControl()throws Exception {
    token=login("ci-admin","This-Is-A-Test-Only-Password-123");
    String suffix=UUID.randomUUID().toString().substring(0,8);
    long publisher=person("S"+suffix,"发布人","creator","第一组");
    long author=person("A"+suffix,"作者","author","第一组");
    long assistant=person("H"+suffix,"官方助理","assistant","第二组");
    credential(publisher,"p-"+suffix);credential(author,"a-"+suffix);credential(assistant,"h-"+suffix);
    JsonNode content=postJson("/api/v1/content-packages",Map.of("title","真实经验分享","body","发布前人工核实的内容","hashtags","#记录","assetIds",List.of()),200);
    long contentId=content.get("id").asLong();
    postJson("/api/v1/content-packages/"+contentId+"/review",Map.of("decision","APPROVE"),200);
    JsonNode batch=postJson("/api/v1/publish-batches",Map.of("title","试运行发布批次","contentId",contentId,"assigneeIds",List.of(publisher),"deadline",java.time.Instant.now().plusSeconds(7200).toString()),200);
    assertEquals(1,batch.get("task_count").asInt());
    long taskId=0;
    for(JsonNode item:getJson("/api/v1/tasks",200))if(item.get("batch_id")!=null && item.get("batch_id").asLong()==batch.get("id").asLong())taskId=item.get("id").asLong();
    assertTrue(taskId>0);
    token=login("p-"+suffix,"Testing-Pass-2026!");
    getJson("/api/v1/customers",403);
    postJson("/api/v1/tasks/"+taskId+"/submissions",Map.of("payload",Map.of("work_url","https://www.douyin.com/video/"+suffix)),200);
    token=login("ci-admin","This-Is-A-Test-Only-Password-123");
    JsonNode approved=postJson("/api/v1/tasks/"+taskId+"/review",Map.of("decision","APPROVE"),200);
    assertEquals("COMPLETED",approved.get("status").asText());
    long work=approved.get("work_id").asLong();
    postJson("/api/v1/works/"+work+"/comments",Map.of("nickname","真实咨询用户","content","请问如何预约？","category","预约"),200);
    Map<String,Object> customerPayload=Map.of("nickname","真实咨询用户","externalUid","UID_"+suffix,"identityVerified",true,"sourceWorkId",work,"contactAllowed",true,"consentBasis","主动咨询并允许答疑");
    long customer=postJson("/api/v1/customers",customerPayload,200).get("id").asLong();
    assertEquals(customer,postJson("/api/v1/customers",customerPayload,200).get("id").asLong());
    JsonNode round=postJson("/api/v1/customers/"+customer+"/contact-rounds",Map.of("authorId",author,"assistantId",assistant,"privateMessage","您好，这里是官方客服，回应您的主动咨询。","deadline",java.time.Instant.now().plusSeconds(7200).toString()),200);
    long first=round.get("author_task_id").asLong(),second=round.get("assistant_task_id").asLong();
    token=login("a-"+suffix,"Testing-Pass-2026!");
    getJson("/api/v1/tasks/"+second,403);
    postJson("/api/v1/tasks/"+first+"/submissions",Map.of("payload",Map.of("reply_status","REPLIED")),400);
    java.awt.image.BufferedImage example=new java.awt.image.BufferedImage(2,2,java.awt.image.BufferedImage.TYPE_INT_RGB);
    java.io.ByteArrayOutputStream png=new java.io.ByteArrayOutputStream();
    assertTrue(javax.imageio.ImageIO.write(example,"png",png));
    MockMultipartFile file=new MockMultipartFile("file","proof.png","image/png",png.toByteArray());
    MvcResult uploaded=mvc.perform(multipart("/api/v1/attachments").file(file).param("purpose","PRIVATE_MESSAGE").header("Authorization","Bearer "+token)).andReturn();
    assertEquals(200,uploaded.getResponse().getStatus(),uploaded.getResponse().getContentAsString());
    long attachment=json.readTree(uploaded.getResponse().getContentAsString()).get("id").asLong();
    postJson("/api/v1/tasks/"+first+"/submissions",Map.of("payload",Map.of("reply_status","REPLIED"),"attachmentId",attachment),200);
    token=login("ci-admin","This-Is-A-Test-Only-Password-123");
    assertEquals("STOPPED",getJson("/api/v1/tasks/"+second,200).get("status").asText());
    assertEquals("RESPONDED",getJson("/api/v1/customers/"+customer,200).get("status").asText());
    assertEquals(0,postJson("/api/v1/ops/tick",Map.of(),200).get("followups").get("created").asInt());
  }
}
