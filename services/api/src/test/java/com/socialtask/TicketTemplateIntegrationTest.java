package com.socialtask;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.socialtask.auth.AuthService;
import com.socialtask.common.Db;
import com.socialtask.wecom.WecomInboxService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Uses the same isolated MySQL+Flyway setup as the other API integration tests. */
@SpringBootTest
@AutoConfigureMockMvc
class TicketTemplateIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired Db db;
    @Autowired WecomInboxService inbox;
    private static final String PASS="Testing-Pass-2026!";

    private MockHttpServletResponseView request(MockHttpServletRequestBuilder call,String token,int status) throws Exception {
        if(token!=null) call.header("Authorization","Bearer "+token);
        var response=mvc.perform(call).andReturn().getResponse();
        assertEquals(status,response.getStatus(),response.getContentAsString());
        return new MockHttpServletResponseView(response.getContentAsByteArray());
    }

    private record MockHttpServletResponseView(byte[] body) {}

    private JsonNode postJson(String path,Object body,String token,int status) throws Exception {
        return json.readTree(request(post("/api/v1/"+path).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(body)),token,status).body());
    }

    private String login(String user,String pass) throws Exception {
        return postJson("auth/login",Map.of("username",user,"password",pass),null,200).path("access_token").asText();
    }

    private long worker(String label,String admin) throws Exception {
        long id=postJson("people",Map.of("personNo",label,"name",label,"personType","support","groupName","第一组"),admin,200).path("id").asLong();
        postJson("people/"+id+"/credentials",Map.of("username",label,"password",PASS),admin,200);
        return id;
    }

    private static List<Map<String,Object>> fields(String responseKey){
        return List.of(Map.of("key","work_material","label","下发图文","phase","DISPATCH","kind","MATERIAL_PACKAGE","required",true),
                       Map.of("key",responseKey,"label","验收回传","phase","RESPONSE","kind","HTTPS_URL","required",true));
    }

    @Test void approvedMaterialDownloadIsAssignmentScopedAndOldTicketKeepsItsSchema() throws Exception {
        String suffix=UUID.randomUUID().toString().substring(0,8), own="own"+suffix, other="other"+suffix, key="ticket_"+suffix;
        String admin=login("ci-admin","This-Is-A-Test-Only-Password-123");
        long assigned=worker(own,admin);
        worker(other,admin);
        String assignee=login(own,PASS), unrelated=login(other,PASS);

        var png=new ByteArrayOutputStream();
        assertTrue(ImageIO.write(new BufferedImage(2,2,BufferedImage.TYPE_INT_RGB),"png",png));
        byte[] bytes=png.toByteArray();
        long asset=json.readTree(request(multipart("/api/v1/attachments")
            .file(new MockMultipartFile("file","approved.png","image/png",bytes)).param("purpose","CONTENT"),admin,200).body()).path("id").asLong();
        long pack=postJson("content-packages",Map.of("title","图文原版","body","原版下发正文","assetIds",List.of(asset)),admin,200).path("id").asLong();

        request(get("/api/v1/ticket-templates"),assignee,403);
        var revision1=Map.of("key",key,"expectedVersion",0,"title","内容下发","fields",fields("old_url"));
        assertEquals(1,postJson("ticket-templates",revision1,admin,200).path("version").asInt());
        postJson("ticket-templates",revision1,admin,409);
        Map<String,Object> ticket=new LinkedHashMap<>(Map.of("title","合成工单","description","模板素材测试","assigneeId",assigned,
                "deadline",Instant.now().plusSeconds(3600).toString(),"templateKey",key,"templateVersion",1));
        postJson("tickets",ticket,admin,400);
        ticket.put("fieldValues",Map.of("work_material",pack));
        postJson("tickets",ticket,admin,400); // DRAFT cannot be dispatched
        postJson("content-packages/"+pack+"/review",Map.of("decision","APPROVE"),admin,200);
        long id=postJson("tickets",ticket,admin,200).path("id").asLong();
        assertTrue(id>0);

        String download="/api/v1/attachments/"+asset;
        assertArrayEquals(bytes,request(get(download),assignee,200).body());
        request(get(download),unrelated,403);
        assertEquals(2,postJson("ticket-templates",Map.of("key",key,"expectedVersion",1,"title","内容下发二版","fields",fields("new_url")),admin,200).path("version").asInt());
        JsonNode old=json.readTree(request(get("/api/v1/tasks/"+id),assignee,200).body());
        var snapshot=json.readTree(old.path("payload_json").asText()).path("template_snapshot");
        assertEquals(1,snapshot.path("template").path("version").asInt());
        assertEquals("图文原版",snapshot.path("values").path("work_material").path("title").asText());
        assertArrayEquals(bytes,request(get(download),assignee,200).body());

        String submit="tasks/"+id+"/submissions";
        postJson(submit,Map.of("payload",Map.of("notes","已完成","fieldValues",Map.of("new_url","https://example.org/new"))),assignee,400);
        var submitted=postJson(submit,Map.of("payload",Map.of("notes","已完成","fieldValues",Map.of("old_url","https://example.org/old"))),assignee,200);
        assertEquals("SUBMITTED",submitted.path("status").asText());
    }

    @Test void conversationTicketTemplateProvenanceAndRetention() throws Exception {
        String suffix=UUID.randomUUID().toString().substring(0,8), own="msgown"+suffix, key="msg_"+suffix;
        String admin=login("ci-admin","This-Is-A-Test-Only-Password-123");
        long assigned=worker(own,admin);
        String assignee=login(own,PASS);
        long first=db.insert("INSERT INTO wecom_conversations(channel,peer_userid) VALUES('WECOM_APP',?)","msg-a-"+suffix);
        long second=db.insert("INSERT INTO wecom_conversations(channel,peer_userid) VALUES('WECOM_APP',?)","msg-b-"+suffix);
        String insert="INSERT INTO wecom_messages(conversation_id,msg_key,direction,message_type,content,message_at) VALUES(?,?,?,'TEXT',?,UTC_TIMESTAMP(3))";
        long source=db.insert(insert,first,AuthService.sha256("src-"+suffix),"INBOUND","合成入站");
        long foreign=db.insert(insert,second,AuthService.sha256("foreign-"+suffix),"INBOUND","其他会话");
        long outbound=db.insert(insert,first,AuthService.sha256("out-"+suffix),"OUTBOUND","发送记录");
        long orphan=db.insert(insert,first,AuthService.sha256("orphan-"+suffix),"INBOUND","待清理");
        postJson("ticket-templates",Map.of("key",key,"expectedVersion",0,"title","会话跟进","fields",List.of(
            Map.of("key","brief","label","处理要求","phase","DISPATCH","kind","TEXT","required",true))),admin,200);
        String endpoint="wecom/inbox/conversations/"+first+"/tickets";
        Map<String,Object> body=new LinkedHashMap<>(Map.of("title","会话工单","description","模拟跟进","assigneeId",assigned,
            "deadline",Instant.now().plusSeconds(3600).toString(),"templateKey",key,"templateVersion",1,"fieldValues",Map.of("brief","核对素材")));
        postJson(endpoint,body,admin,400);
        body.put("sourceMessageId",foreign);postJson(endpoint,body,admin,409);
        body.put("sourceMessageId",outbound);postJson(endpoint,body,admin,409);
        body.put("sourceMessageId",source);
        postJson(endpoint,body,assignee,403);
        request(get("/api/v1/"+endpoint),assignee,403);
        assertEquals(0,json.readTree(request(get("/api/v1/"+endpoint),admin,200).body()).size());
        JsonNode ticket=postJson(endpoint,body,admin,200);
        long id=ticket.path("id").asLong();assertTrue(id>0);
        assertEquals(source,ticket.path("source_message_id").asLong());
        assertEquals("核对素材",json.readTree(ticket.path("payload_json").asText()).path("template_snapshot").path("values").path("brief").asText());
        JsonNode list=json.readTree(request(get("/api/v1/"+endpoint),admin,200).body());
        assertEquals(1,list.size());assertEquals(id,list.get(0).path("id").asLong());
        assertEquals(0,json.readTree(request(get("/api/v1/wecom/inbox/conversations/"+second+"/tickets"),admin,200).body()).size());

        db.execute("UPDATE wecom_messages SET message_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 4000 DAY) WHERE id IN (?,?)",source,orphan);
        inbox.purge();
        var retained=db.one("SELECT * FROM wecom_messages WHERE id=?",source);
        assertNull(retained.get("content"));assertEquals("REDACTED",retained.get("delivery_status"));
        assertNull(db.optional("SELECT id FROM wecom_messages WHERE id=?",orphan));
        assertEquals(1,json.readTree(request(get("/api/v1/"+endpoint),admin,200).body()).size());
        postJson(endpoint,body,admin,409);
        postJson("tickets",body,admin,409); // Direct ticket API enforces the same retention guard.
    }
}
