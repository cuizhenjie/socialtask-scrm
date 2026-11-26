package com.socialtask.settings;

import com.fasterxml.jackson.databind.*;
import com.socialtask.common.Db;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.http.MediaType;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@SpringBootTest(properties={"app.settings.master-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","app.settings.llm-allowed-origins=https://model-a.example.test,https://model-b.example.test"})
@AutoConfigureMockMvc
class LlmProfileIntegrationTest {
 @Autowired MockMvc mvc;@Autowired ObjectMapper json;@Autowired Db db;
 @MockitoBean LlmReviewTransport transport;
 private JsonNode call(MockHttpServletRequestBuilder req,String token,Object data,int expected)throws Exception{
    if(token!=null)req.header("Authorization","Bearer "+token);
    if(data!=null)req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(data));
    var response=mvc.perform(req).andReturn().getResponse();assertEquals(expected,response.getStatus(),response.getContentAsString());
    return json.readTree(response.getContentAsString());
 }
 @Test void encryptedProfileVersionScopeAndSanitizedReview()throws Exception{
    String admin=call(post("/api/v1/auth/login"),null,Map.of("username","ci-admin","password","This-Is-A-Test-Only-Password-123"),200).path("access_token").asText();
    String route="/api/v1/settings/llm",key="unit-only-secret-llm";
    var initial=call(get(route),admin,null,200);
    int version=initial.path("version").asInt();
    Map<String,Object> input=new LinkedHashMap<>(Map.of("expectedVersion",version,"enabled",true,"url","https://model-a.example.test/v1","baseUrl",true,"model","unit-model","apiKey",key));
    var saved=call(put(route),admin,input,200);
    assertEquals(version+1,saved.path("version").asInt());assertTrue(saved.path("key_configured").asBoolean());assertFalse(saved.toString().contains(key));
    String cipher=Db.str(db.one("SELECT key_cipher FROM llm_profile WHERE id=1").get("key_cipher"));
    assertFalse(cipher.contains(key));assertFalse(call(get(route),admin,null,200).toString().contains(cipher));
    call(put(route),admin,input,409);
    input.put("expectedVersion",version+1);input.remove("apiKey");input.put("url","https://model-b.example.test/v1");
    call(put(route),admin,input,400);
    input.put("url","https://model-a.example.test.evil/v1");call(put(route),admin,input,400);
    String templateKey="fixture_"+UUID.randomUUID().toString().substring(0,8);
    String title="unit-private-title",label="unit-private-label",fieldKey="unit_private_field";
    call(post("/api/v1/ticket-templates"),admin,Map.of("key",templateKey,"title",title,"expectedVersion",0,
      "fields",List.of(Map.of("key",fieldKey,"label",label,"phase","DISPATCH","kind","TEXT","required",true))),200);
    call(post(route+"/review"),admin,Map.of("templateKey",templateKey,"version",1,"approveSanitized",false),400);
    verifyNoInteractions(transport);
    when(transport.post(eq("https://model-a.example.test/v1/chat/completions"),eq(key),anyString())).thenAnswer(inv->{
        String payload=inv.getArgument(2);
        for(String secret:List.of(templateKey,title,label,fieldKey,key))assertFalse(payload.contains(secret));
        JsonNode body=json.readTree(payload);assertEquals("unit-model",body.path("model").asText());
        JsonNode fields=json.readTree(body.path("messages").path(1).path("content").asText()).path("fields");
        assertEquals(1,fields.size());assertEquals("TEXT",fields.path(0).path("kind").asText());
        return "{\"choices\":[{\"message\":{\"content\":\"建议 "+key+"\"}}]}";
    });
    var result=call(post(route+"/review"),admin,Map.of("templateKey",templateKey,"version",1,"approveSanitized",true),200);
    assertEquals(1,result.path("fields_sent").asInt());assertFalse(result.path("applied").asBoolean());assertFalse(result.toString().contains(key));
    input.put("url","https://model-a.example.test/v1");input.put("enabled",false);input.put("clearKey",true);
    assertFalse(call(put(route),admin,input,200).path("key_configured").asBoolean());
    call(post(route+"/review"),admin,Map.of("templateKey",templateKey,"version",1,"approveSanitized",true),409);
    verify(transport,times(1)).post(anyString(),anyString(),anyString());
 }
}
