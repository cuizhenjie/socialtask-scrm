package com.socialtask;
import com.socialtask.auth.RequestUser;
import com.socialtask.common.*;
import com.socialtask.notification.WecomGateway;
import com.socialtask.wecom.WecomDispatchService;
import org.junit.jupiter.api.*;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class WecomDispatchServiceTest {
 @AfterEach void clear(){SecurityContextHolder.clearContext();}
 @Test void unknownResultIsNotSentAgainAndChangedPayloadIsRejected()throws Exception{
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(new RequestUser(1L,"unit","admin",null),null,List.of()));
    Db db=mock(Db.class);Audit audit=mock(Audit.class);WecomGateway gateway=mock(WecomGateway.class);
    PlatformTransactionManager tx=mock(PlatformTransactionManager.class);when(tx.getTransaction(any())).thenAnswer(i->new SimpleTransactionStatus());
    var service=new WecomDispatchService(db,audit,gateway,tx);
    String request=UUID.randomUUID().toString();
    String fingerprint=com.socialtask.auth.AuthService.sha256("TEXT:"+com.socialtask.auth.AuthService.sha256("test")+":test");
    when(db.one("SELECT * FROM wecom_conversations WHERE id=? FOR UPDATE",1L)).thenReturn(Map.of("id",1L,"channel","WECOM_APP","person_id",2L,"peer_userid","unit"));
    when(db.optional(startsWith("SELECT id,request_fingerprint"),anyString())).thenReturn(null,Map.of("id",3L,"request_fingerprint",fingerprint));
    when(gateway.configured()).thenReturn(true);
    when(db.list(startsWith("SELECT id,wecom_userid FROM people"),eq("unit"))).thenReturn(List.of(Map.of("id",2L,"wecom_userid","unit")));
    when(db.insert(startsWith("INSERT INTO wecom_messages"),any(Object[].class))).thenReturn(3L);
    when(db.one(startsWith("SELECT id,conversation_id,direction"),eq(3L))).thenReturn(Map.of("id",3L,"delivery_status","UNKNOWN"));
    when(gateway.sendText("unit","test")).thenThrow(new java.io.IOException("secret-bearing error"));
    assertEquals("UNKNOWN",service.text(1L,request,"test").get("delivery_status"));
    assertEquals("UNKNOWN",service.text(1L,request,"test").get("delivery_status"));
    assertEquals(409,assertThrows(ApiException.class,()->service.text(1L,request,"different")).status);
    verify(gateway,times(1)).sendText("unit","test");
    verify(db).execute(startsWith("UPDATE wecom_messages SET delivery_status"),eq("UNKNOWN"),isNull(),eq(3L));
 }
}
