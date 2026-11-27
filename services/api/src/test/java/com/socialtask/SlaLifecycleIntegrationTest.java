package com.socialtask;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import com.fasterxml.jackson.databind.*;
import com.socialtask.common.Db;
import com.socialtask.sla.SlaService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@EnabledIfEnvironmentVariable(named = "SUPABASE_URL", matches = ".+")
@SpringBootTest
@AutoConfigureMockMvc
class SlaLifecycleIntegrationTest {
    @Autowired MockMvc mvc;@Autowired ObjectMapper json;@Autowired Db db;@Autowired SlaService sla;
    private JsonNode call(MockHttpServletRequestBuilder req,String token,int status)throws Exception{
        if(token!=null)req.header("Authorization","Bearer "+token);
        var r=mvc.perform(req).andReturn().getResponse();assertEquals(status,r.getStatus(),r.getContentAsString());
        return json.readTree(r.getContentAsString());
    }
    private JsonNode postJson(String route,String token,Object body,int status)throws Exception{
        return call(post("/api/v1/"+route).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)),token,status);
    }
    private String login(String name,String password)throws Exception{
        return postJson("auth/login",null,Map.of("username",name,"password",password),200).path("access_token").asText();
    }
    @Test void pausePreservesBusinessDeadlineAndEscalatesExactlyOnce()throws Exception{
        String admin=login("ci-admin","This-Is-A-Test-Only-Password-123"),suffix=UUID.randomUUID().toString().substring(0,8),name="sla-"+suffix,pass="Testing-Pass-2026!";
        long person=postJson("people",admin,Map.of("personNo",name,"name",name,"personType","support","groupName","第一组"),200).path("id").asLong();
        postJson("people/"+person+"/credentials",admin,Map.of("username",name,"password",pass),200);
        String worker=login(name,pass);
        var body=Map.of("title","SLA 合成工单","description","测试","assigneeId",person,"deadline",Instant.now().plusSeconds(86400).toString());
        JsonNode ticket=postJson("tickets",admin,body,200);long id=ticket.path("id").asLong();String route="tasks/"+id;
        var old=db.one("SELECT * FROM task_sla WHERE task_id=?",id);assertNotNull(old.get("calendar_snapshot"));
        postJson(route+"/sla/pause",worker,Map.of("reason","越权暂停"),403);
        postJson(route+"/sla/pause",admin,Map.of("reason","等待合成资料"),200);
        var paused=db.one("SELECT * FROM task_sla WHERE task_id=?",id);
        assertNotNull(paused.get("paused_at"));assertTrue(Db.l(paused.get("response_remaining_ms"))>0);
        postJson(route+"/sla/pause",admin,Map.of("reason","重复"),409);
        postJson(route+"/submissions",worker,Map.of("payload",Map.of("notes","合成结果")),409);
        var list=call(get("/api/v1/tasks").param("sla","CLOCK_PAUSED"),admin,200);
        boolean present=false;for(var row:list)if(row.path("id").asLong()==id)present=true;assertTrue(present);
        call(post("/api/v1/"+route+"/sla/resume"),admin,200);
        var resumed=db.one("SELECT * FROM task_sla WHERE task_id=?",id);assertNull(resumed.get("paused_at"));assertEquals(1,Db.n(resumed.get("pause_count")));
        assertFalse(Db.instant(resumed.get("response_due_at")).isBefore(Db.instant(old.get("response_due_at"))));
        assertEquals(ticket.path("due_at"),call(get("/api/v1/"+route),admin,200).path("due_at"));
        postJson(route+"/submissions",worker,Map.of("payload",Map.of("notes","合成结果")),200);
        assertEquals("COMPLETED",postJson(route+"/review",admin,Map.of("decision","APPROVE"),200).path("status").asText());

        long late=postJson("tickets",admin,body,200).path("id").asLong();
        db.execute("UPDATE task_sla SET response_due_at=(now() - INTERVAL '10 minutes'),escalation_minutes='1,2' WHERE task_id=?",late);
        sla.tick();sla.tick();sla.tick();
        var escalated=db.one("SELECT * FROM task_sla WHERE task_id=?",late);
        assertNotNull(escalated.get("response_breached_at"));assertEquals(2,Db.n(escalated.get("response_escalation_level")));
        assertEquals(2,Db.n(db.one("SELECT COUNT(*) AS n FROM notifications WHERE task_id=? AND event_type='SLA_RESPONSE_ESCALATION'",late).get("n")));
        postJson("tasks/"+late+"/sla/pause",admin,Map.of("reason","不得隐藏违约"),409);
    }
}
