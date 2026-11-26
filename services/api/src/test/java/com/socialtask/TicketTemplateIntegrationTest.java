package com.socialtask;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
}
