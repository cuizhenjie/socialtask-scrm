package com.socialtask;

import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Requires MySQL 8.4 + Flyway V1/V2/V3; exercised by GitHub Actions api-tests job, not offline shell. */
@SpringBootTest
@AutoConfigureMockMvc
class EnhancementsIntegrationTest {
 @Autowired MockMvc mvc;@Autowired ObjectMapper mapper;
 private String admin;
 private JsonNode req(MockHttpServletRequestBuilder b,int expect)throws Exception{
    MvcResult r=mvc.perform(b).andReturn();assertEquals(expect,r.getResponse().getStatus(),r.getResponse().getContentAsString());
    return mapper.readTree(r.getResponse().getContentAsString());
 }
 private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder b,String token){return b.header("Authorization","Bearer "+token);}
 private String login(String user,String pass)throws Exception{return req(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of("username",user,"password",pass))),200).get("access_token").asText();}
 private JsonNode postJson(String url,Object payload,String token,int code)throws Exception{return req(auth(post(url),token).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(payload)),code);}
 private JsonNode getJson(String url,String token,int code)throws Exception{return req(auth(get(url),token),code);}
 @Test void groupTagsTicketSlaAndReports()throws Exception{
    admin=login("ci-admin","This-Is-A-Test-Only-Password-123");
    String suffix=UUID.randomUUID().toString().substring(0,8);String group="测试组-"+suffix;
    // CRM customer grouping and tags must not be confused with employee/team tagging.
    String segment="客户组-"+suffix;
    long segmentId=postJson("/api/v1/customers/segments",Map.of("name",segment,"description","integration"),admin,200).get("id").asLong();
    long customerTag=postJson("/api/v1/customers/tags",Map.of("name","咨询类-"+suffix),admin,200).get("id").asLong();
    JsonNode customer=postJson("/api/v1/customers",Map.of("nickname","待核实客户-"+suffix,"identityVerified",false,"contactAllowed",false),admin,200);
    long customerId=customer.get("id").asLong();
    req(auth(put("/api/v1/customers/"+customerId+"/classification"),admin).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of("segmentId",segmentId,"tagIds",List.of(customerTag)))),200);
    var customers=getJson("/api/v1/customers?segmentId="+segmentId+"&tagId="+customerTag,admin,200);
    assertTrue(customers.size()>0);assertEquals(customerId,customers.get(0).get("id").asLong());
        postJson("/api/v1/people/groups",Map.of("name",group,"description","integration"),admin,200);
    long tag=postJson("/api/v1/people/tags",Map.of("name","重要客户-"+suffix),admin,200).get("id").asLong();
    long person=postJson("/api/v1/people",Map.of("personNo","T"+suffix,"name","客服"+suffix,"personType","support","groupName",group),admin,200).get("id").asLong();
    req(auth(put("/api/v1/people/"+person+"/tags"),admin).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of("tagIds",List.of(tag)))),200);
    JsonNode people=req(auth(get("/api/v1/people").param("group",group).param("tagId",Long.toString(tag)),admin),200);
    assertTrue(people.size()>=1);assertEquals(person,people.get(0).get("id").asLong());
    postJson("/api/v1/people/"+person+"/credentials",Map.of("username","s-"+suffix,"password","Testing-Pass-2026!"),admin,200);
    String deadline=Instant.now().plus(Duration.ofHours(10)).toString();
    JsonNode ticket=postJson("/api/v1/tickets",Map.of("title","新服务工单","description","来自人工确认的真实咨询","assigneeId",person,"deadline",deadline,"priority","HIGH"),admin,200);
    long id=ticket.get("id").asLong();assertEquals("SERVICE_TICKET",ticket.get("type").asText());
    assertEquals("HIGH",ticket.get("priority").asText());
    assertNotNull(ticket.get("sla").get("response_due_at"));
    var listed=req(auth(get("/api/v1/tasks").param("group",group).param("tagId",Long.toString(tag)).param("priority","HIGH"),admin),200);
    assertTrue(listed.size()>=1);
    var summary=req(auth(get("/api/v1/reports/tickets").param("group",group),admin),200);
    assertTrue(summary.get("summary").get("total").asInt()>=1);
    String user=login("s-"+suffix,"Testing-Pass-2026!");
    getJson("/api/v1/reports/tickets",user,403);
    postJson("/api/v1/tasks/"+id+"/submissions",Map.of("payload",Map.of("notes","已按约定完成线索回访核查")),user,200);
    postJson("/api/v1/tasks/"+id+"/priority",Map.of("priority","URGENT"),admin,409);
    var approved=postJson("/api/v1/tasks/"+id+"/review",Map.of("decision","APPROVE"),admin,200);
    assertEquals("COMPLETED",approved.get("status").asText());
    assertNotNull(approved.get("sla").get("resolved_at"));
 }
}
