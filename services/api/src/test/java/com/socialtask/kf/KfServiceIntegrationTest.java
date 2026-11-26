package com.socialtask.kf;

import com.socialtask.auth.AuthService;
import com.socialtask.auth.RequestUser;
import com.socialtask.common.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest
class KfServiceIntegrationTest {
    @Autowired Db db;
    @Autowired KfService service;
    @MockitoBean KfSyncClient client;
    private static void identity(String role){
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(new RequestUser(1L,"ci-admin",role,null),null,List.of()));
    }
    @AfterEach void clear(){SecurityContextHolder.clearContext();}
    @Test void cursorReplayAndRecallAreAtomicAndScopeIsolated(){
        String account=AuthService.sha256("kf-fixture:"+UUID.randomUUID()),peer=AuthService.sha256(account+":peer"),message=AuthService.sha256(account+":m"),event=AuthService.sha256(account+":r"),next=AuthService.sha256(account+":next");
        when(client.enabled()).thenReturn(true);when(client.authorized()).thenReturn(true);when(client.configured()).thenReturn(true);when(client.accountKey()).thenReturn(account);when(client.retentionDays()).thenReturn(30);
        Instant now=Instant.now();
        var text=new KfPage.Message(message,peer,3,"text","合成客户消息",now,null);
        var recall=new KfPage.Message(event,peer,4,"event","[客服事件] user_recall_msg",now.plusSeconds(1),message);
        var second=new KfPage.Message(next,peer,5,"text","合成接待回复",now.plusSeconds(2),null);
        // Event first: out-of-order recall still redacts the later original.
        when(client.fetch("")).thenReturn(new KfPage("c1",true,List.of(recall,text)));
        when(client.fetch("c1")).thenReturn(new KfPage("c2",false,List.of(text,second)));
        when(client.fetch("c2")).thenThrow(new ApiException(502,"合成上游失败"));
        identity("manager");assertEquals(403,assertThrows(ApiException.class,service::conversations).status);
        identity("admin");assertEquals(400,assertThrows(ApiException.class,()->service.sync(false)).status);
        assertEquals(2,service.sync(true).get("processed"));
        assertEquals(429,assertThrows(ApiException.class,()->service.sync(true)).status);
        assertEquals("c1",db.one("SELECT cursor_value FROM kf_sync_state WHERE account_key=?",account).get("cursor_value"));
        assertNull(db.one("SELECT content FROM kf_messages WHERE message_key=?",message).get("content"));
        db.execute("UPDATE kf_sync_state SET last_attempt_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 61 SECOND) WHERE account_key=?",account);
        assertEquals(2,service.sync(true).get("processed"));
        assertEquals(3,service.messages(peer).size());assertEquals(1,service.conversations().size());
        assertNull(db.one("SELECT content FROM kf_messages WHERE message_key=?",message).get("content"));
        assertTrue(Db.bool(db.one("SELECT recalled FROM kf_messages WHERE message_key=?",message).get("recalled")));
        assertFalse(service.state().containsKey("cursor_value"));
        assertEquals("c2",db.one("SELECT cursor_value FROM kf_sync_state WHERE account_key=?",account).get("cursor_value"));
        db.execute("UPDATE kf_sync_state SET last_attempt_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 61 SECOND) WHERE account_key=?",account);
        assertEquals(502,assertThrows(ApiException.class,()->service.sync(true)).status);
        assertEquals("c2",db.one("SELECT cursor_value FROM kf_sync_state WHERE account_key=?",account).get("cursor_value"));
        when(client.accountKey()).thenReturn(AuthService.sha256("different-"+account));
        assertTrue(service.messages(peer).isEmpty());assertTrue(service.conversations().isEmpty());
        when(client.configured()).thenReturn(false);
        assertEquals(409,assertThrows(ApiException.class,service::conversations).status);
        verify(client,times(1)).fetch("");verify(client,times(1)).fetch("c1");verify(client,times(1)).fetch("c2");
    }
}
