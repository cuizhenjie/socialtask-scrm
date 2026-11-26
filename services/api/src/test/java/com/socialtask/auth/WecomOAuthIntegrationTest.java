package com.socialtask.auth;

import com.fasterxml.jackson.databind.*;
import com.socialtask.common.Db;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Real MySQL/Flyway/session/access-control integration; only the external provider is mocked. */
@SpringBootTest(properties={"app.wecom.oauth-enabled=true","app.wecom.enabled=false","app.scheduler.enabled=false"})
@AutoConfigureMockMvc
class WecomOAuthIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired Db db;
    @Autowired AuthService auth;
    @MockitoBean WecomOAuthClient provider;
    private static final String BROWSER="a".repeat(64), OTHER="b".repeat(64);
    private String uid(){return "qa_"+UUID.randomUUID().toString().replace("-","");}
    private record Fixture(long person,long user,String username){}
    private Fixture fixture(String userid,boolean active,String personStatus,boolean provision){
        String username=uid();
        long person=db.insert("INSERT INTO people(person_no,name,person_type,wecom_userid,status) VALUES(?,?,?,?,?)",uid(),"OAuth QA fixture","support",userid,personStatus);
        long user=provision?db.insert("INSERT INTO users(username,password_hash,role,person_id,active) VALUES(?,?,?,?,?)",username,"not-a-real-password-hash","support",person,active):0;
        return new Fixture(person,user,username);
    }
    private long task(long person){return db.insert("INSERT INTO tasks(task_no,title,type,assignee_id,due_at,payload_json) VALUES(?,?,?,?,?,?)",uid(),"OAuth QA ticket","SERVICE_TICKET",person,Db.stamp(Instant.now().plusSeconds(3600)),"{}");}
    private JsonNode call(String path,Map<String,?> body,int expected)throws Exception{
        var response=mvc.perform(post("/api/v1/auth/wecom/"+path).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))).andReturn().getResponse();
        assertEquals(expected,response.getStatus(),response.getContentAsString());return json.readTree(response.getContentAsString());
    }
    private String start(String browser,String next)throws Exception{
        when(provider.authorization(anyString())).thenAnswer(a->"https://open.weixin.qq.com/connect/oauth2/authorize?state="+a.getArgument(0)+"#wechat_redirect");
        String url=call("start",Map.of("browserNonce",browser,"next",next),200).path("authorization_url").asText();
        return url.substring(url.indexOf("state=")+6,url.indexOf('#'));
    }
    private Map<String,String> exchange(String state,String browser){return Map.of("state",state,"browserNonce",browser,"code","mock-code");}
    @Test void boundMemberGetsOriginalTicketAndNormalRevocableSession()throws Exception{
        String userid=uid();var member=fixture(userid,true,"ACTIVE",true);var other=fixture(uid(),true,"ACTIVE",true);
        long own=task(member.person()),foreign=task(other.person());String next="/m/tasks/"+own;
        when(provider.userId("mock-code")).thenReturn(userid);
        String state=start(BROWSER,next);
        var response=call("exchange",exchange(state,BROWSER),200);
        String token=response.path("access_token").asText();assertEquals(43,token.length());assertEquals(43200,response.path("expires_in").asInt());
        assertEquals(next,response.path("next").asText());assertEquals(member.user(),response.path("user").path("id").asLong());assertEquals("support",response.path("user").path("role").asText());
        assertNotNull(db.optional("SELECT id FROM sessions WHERE token_hash=? AND user_id=? AND auth_method='WECOM'",AuthService.sha256(token),member.user()));
        assertEquals(200,mvc.perform(get("/api/v1/tasks/"+own).header("Authorization","Bearer "+token)).andReturn().getResponse().getStatus());
        assertEquals(403,mvc.perform(get("/api/v1/tasks/"+foreign).header("Authorization","Bearer "+token)).andReturn().getResponse().getStatus());
        assertEquals(403,mvc.perform(get("/api/v1/customers").header("Authorization","Bearer "+token)).andReturn().getResponse().getStatus());
        call("exchange",exchange(state,BROWSER),400);verify(provider,times(1)).userId("mock-code");
        assertEquals(200,mvc.perform(post("/api/v1/auth/logout").header("Authorization","Bearer "+token)).andReturn().getResponse().getStatus());
        assertEquals(401,mvc.perform(get("/api/v1/me").header("Authorization","Bearer "+token)).andReturn().getResponse().getStatus());
    }
    @Test void wrongBrowserExpiredAndConcurrentReplayCannotExchange()throws Exception{
        String userid=uid();fixture(userid,true,"ACTIVE",true);when(provider.userId("mock-code")).thenReturn(userid);
        String state=start(BROWSER,"https://evil.invalid");
        call("exchange",exchange(state,OTHER),400);verify(provider,never()).userId(anyString());
        db.execute("UPDATE wecom_oauth_states SET expires_at=? WHERE state_hash=?",Db.stamp(Instant.now().minusSeconds(1)),AuthService.sha256(state));
        call("exchange",exchange(state,BROWSER),400);verify(provider,never()).userId(anyString());
        String valid=start(BROWSER,"//evil.invalid");
        try(var pool=Executors.newFixedThreadPool(2)){
            var body=json.writeValueAsString(exchange(valid,BROWSER));
            Callable<Integer> request=()->mvc.perform(post("/api/v1/auth/wecom/exchange").contentType(MediaType.APPLICATION_JSON).content(body)).andReturn().getResponse().getStatus();
            var results=pool.invokeAll(List.of(request,request));var statuses=new ArrayList<Integer>();for(var r:results)statuses.add(r.get());Collections.sort(statuses);assertEquals(List.of(200,400),statuses);
        }
        verify(provider,times(1)).userId("mock-code");
    }
    @Test void unboundInactiveAndAmbiguousIdentitiesNeverGetSessions()throws Exception{
        String unbound=uid(),inactivePerson=uid(),inactiveAccount=uid(),unprovisioned=uid(),duplicatePerson=uid(),duplicateAccount=uid();
        fixture(inactivePerson,true,"INACTIVE",true);fixture(inactiveAccount,false,"ACTIVE",true);fixture(unprovisioned,true,"ACTIVE",false);
        fixture(duplicatePerson,true,"ACTIVE",true);fixture(duplicatePerson,true,"ACTIVE",true);
        var same=fixture(duplicateAccount,true,"ACTIVE",true);
        db.insert("INSERT INTO users(username,password_hash,role,person_id,active) VALUES(?,?,?,?,?)",uid(),"not-a-real-password-hash","support",same.person(),true);
        for(String userid:List.of(unbound,inactivePerson,inactiveAccount,unprovisioned,duplicatePerson,duplicateAccount)){
            when(provider.userId("mock-code")).thenReturn(userid);String state=start(BROWSER,"/m/tasks/1");
            var failure=call("exchange",exchange(state,BROWSER),403);assertFalse(failure.has("access_token"));call("exchange",exchange(state,BROWSER),400);
        }
    }
    @Test void bindingChangeRevokesOnlyOAuthSessions()throws Exception{
        String userid=uid();var member=fixture(userid,true,"ACTIVE",false);
        String password="Local-QA-Only-Pass-123";
        auth.createUser(member.username(),password,"support",member.person());
        String passwordToken=(String)auth.login(member.username(),password).get("access_token");
        when(provider.userId("mock-code")).thenReturn(userid);
        String oauth=call("exchange",exchange(start(BROWSER,"/m/tasks/1"),BROWSER),200).path("access_token").asText();
        var login=mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("username","ci-admin","password","This-Is-A-Test-Only-Password-123")))).andReturn().getResponse();
        assertEquals(200,login.getStatus());String admin=json.readTree(login.getContentAsString()).path("access_token").asText();
        var changed=mvc.perform(patch("/api/v1/people/"+member.person()).header("Authorization","Bearer "+admin).contentType(MediaType.APPLICATION_JSON).content("{\"wecomUserId\":\"\"}")).andReturn().getResponse();
        assertEquals(200,changed.getStatus(),changed.getContentAsString());
        assertNull(auth.authenticate(oauth));assertNotNull(auth.authenticate(passwordToken));
        call("exchange",exchange(start(BROWSER,"/m/tasks/1"),BROWSER),403);
    }
    @Test void disabledProviderAndFailedCodeDoNotMintSession()throws Exception{
        doThrow(new com.socialtask.common.ApiException(404,"disabled")).when(provider).requireConfigured();
        call("start",Map.of("browserNonce",BROWSER),404);verify(provider,never()).authorization(anyString());
        doNothing().when(provider).requireConfigured();
        String state=start(BROWSER,"/m/tasks/1");when(provider.userId("mock-code")).thenThrow(new com.socialtask.common.ApiException(401,"invalid"));
        call("exchange",exchange(state,BROWSER),401);call("exchange",exchange(state,BROWSER),400);verify(provider,times(1)).userId(anyString());
    }
}
