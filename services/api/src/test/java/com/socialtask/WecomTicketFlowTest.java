package com.socialtask;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.socialtask.auth.AuthService;
import com.socialtask.auth.RequestUser;
import com.socialtask.common.ApiException;
import com.socialtask.common.Audit;
import com.socialtask.common.Db;
import com.socialtask.notification.NotificationService;
import com.socialtask.notification.WecomGateway;
import com.socialtask.sla.SlaService;
import com.socialtask.task.TaskService;
import com.socialtask.wecom.WecomCrypto;
import com.socialtask.wecom.WecomInboxController;
import com.socialtask.wecom.WecomInboxService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.ArgumentMatchers;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Actual domain services exercised with database and WeCom HTTP dependencies replaced by mocks. */
class WecomTicketFlowTest {
    private static final String CORP = "ww-unit-corp";
    private static final String AES_KEY = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA";
    private static final String TOKEN = "unit-only-token";
    private static final String UID = "unit-support";
    private static final String TEXT = "单元测试消息：请求协助";
    private static final long ASSIGNEE = 7L;
    private static final long THREAD = 11L;
    private static final long MESSAGE = 12L;
    private static final long TICKET = 13L;
    private static final long NOTICE = 14L;

    @AfterEach void clearIdentity() { SecurityContextHolder.clearContext(); }

    @Test void signedInboundMessageEntersInboxOnceAndInvalidSignatureNeverPersists() {
        Db db = mock(Db.class);
        var controller = new WecomInboxController(new WecomInboxService(db, mock(Audit.class), mock(WecomGateway.class)));
        ReflectionTestUtils.setField(controller, "callbackEnabled", true);
        ReflectionTestUtils.setField(controller, "corpId", CORP);
        ReflectionTestUtils.setField(controller, "callbackToken", TOKEN);
        ReflectionTestUtils.setField(controller, "aesKey", AES_KEY);
        var crypto = new WecomCrypto(TOKEN, AES_KEY, CORP);
        String timestamp = Long.toString(Instant.now().getEpochSecond());
        String nonce = "unit-nonce";
        String xml = "<xml><ToUserName>" + CORP + "</ToUserName><FromUserName>" + UID
            + "</FromUserName><CreateTime>" + timestamp + "</CreateTime><MsgType>text</MsgType>"
            + "<Content>" + TEXT + "</Content><MsgId>unit-msg-12</MsgId></xml>";
        String encrypted = crypto.encryptForTest(xml, new byte[16]);
        String body = "<xml><Encrypt><![CDATA[" + encrypted + "]]></Encrypt></xml>";
        assertEquals(403, controller.receive("invalid", timestamp, nonce, body).getStatusCode().value());
        verifyNoInteractions(db);

        String hash = AuthService.sha256("WECOM_APP:unit-msg-12");
        Map<String,Object> row = Map.of("id", MESSAGE, "direction", "INBOUND", "content", TEXT);
        when(db.list(startsWith("SELECT id FROM people"), eq(UID))).thenReturn(List.of(Map.of("id", ASSIGNEE)));
        when(db.one(startsWith("SELECT id FROM wecom_conversations WHERE channel"), eq(UID))).thenReturn(Map.of("id", THREAD));
        when(db.optional("SELECT id FROM wecom_messages WHERE msg_key=?", hash)).thenReturn(null, Map.of("id", MESSAGE));
        when(db.one("SELECT id FROM wecom_conversations WHERE id=?", THREAD)).thenReturn(Map.of("id", THREAD));
        when(db.list(startsWith("SELECT * FROM wecom_messages"), eq(THREAD))).thenReturn(List.of(row));

        String signature = crypto.signature(timestamp, nonce, encrypted);
        var response = controller.receive(signature, timestamp, nonce, body);
        assertEquals(200, response.getStatusCode().value());
        assertEquals("success", response.getBody());
        assertEquals("success", controller.receive(signature, timestamp, nonce, body).getBody());
        verify(db, times(1)).execute(startsWith("INSERT INTO wecom_messages"), eq(THREAD), eq(hash),
            eq("TEXT"), eq(TEXT), eq("unit-msg-12"), notNull());
        verify(db, times(1)).execute(startsWith("UPDATE wecom_conversations SET unread_count"), notNull(), eq(THREAD));

        identity("admin", null);
        assertEquals(List.of(row), controller.messages(THREAD));
        identity("staff", ASSIGNEE);
        assertThrows(ApiException.class, () -> controller.messages(THREAD));
    }

    @Test void incomingApplicationMessageBecomesLinkedTicketAndOnlyItsAssigneeCanReadIt() {
        Db db = mock(Db.class);
        var service = new TaskService(db, mock(Audit.class), mock(SlaService.class));
        when(db.one("SELECT person_type,status FROM people WHERE id=?", ASSIGNEE))
            .thenReturn(Map.of("status", "ACTIVE", "person_type", "support"));
        when(db.one("SELECT direction,delivery_status FROM wecom_messages WHERE id=? FOR UPDATE", MESSAGE))
            .thenReturn(Map.of("direction", "OUTBOUND","delivery_status","ACCEPTED"), Map.of("direction", "INBOUND","delivery_status","REDACTED"), Map.of("direction", "INBOUND","delivery_status","RECEIVED"));
        when(db.one(startsWith("SELECT t.*,p.name AS assignee_name"), eq(TICKET)))
            .thenReturn(Map.of("id", TICKET, "assignee_id", ASSIGNEE, "source_message_id", MESSAGE, "type", "SERVICE_TICKET"));
        when(db.insert(startsWith("INSERT INTO tasks"), any(Object[].class))).thenReturn(TICKET);

        String deadline = Instant.now().plusSeconds(3600).toString();
        identity("admin", null);
        var input = new TaskService.TicketIn("模拟建单", TEXT, ASSIGNEE, deadline, "NORMAL", MESSAGE);
        assertThrows(ApiException.class, () -> service.createTicket(input));
        assertThrows(ApiException.class, () -> service.createTicket(input));
        verify(db, never()).insert(startsWith("INSERT INTO tasks"), any(Object[].class));

        var ticket = service.createTicket(input);
        assertEquals(TICKET, ticket.get("id"));
        assertEquals(MESSAGE, ticket.get("source_message_id"));
        verify(db).execute("UPDATE tasks SET source_message_id=? WHERE id=?", MESSAGE, TICKET);
        verify(db).execute(startsWith("INSERT INTO notifications"), eq("TASK:" + TICKET + ":CREATE"), eq(TICKET),
            eq(ASSIGNEE), eq("TASK_CREATED"), contains("模拟建单"));

        identity("staff", ASSIGNEE + 1);
        assertThrows(ApiException.class, () -> service.get(TICKET));
        identity("staff", ASSIGNEE);
        assertEquals(TICKET, service.get(TICKET).get("id"));
    }

    @Test void outboxSendsTextCardWithOriginalTicketAndRecordsOnlyProviderAcceptance() throws Exception {
        Db db = mock(Db.class);
        PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenAnswer(invocation -> new SimpleTransactionStatus());
        var gateway = new WecomGateway();
        HttpClient transport = mock(HttpClient.class);
        ReflectionTestUtils.setField(gateway, "http", transport);
        ReflectionTestUtils.setField(gateway, "enabled", true);
        ReflectionTestUtils.setField(gateway, "corpId", CORP);
        ReflectionTestUtils.setField(gateway, "secret", "unit-only-secret");
        ReflectionTestUtils.setField(gateway, "agentId", 10001);
        ReflectionTestUtils.setField(gateway, "publicUrl", "https://socialtask.example.test/");
        @SuppressWarnings("unchecked") HttpResponse<String> getToken = mock(HttpResponse.class);
        @SuppressWarnings("unchecked") HttpResponse<String> sendCard = mock(HttpResponse.class);
        when(getToken.statusCode()).thenReturn(200);
        when(getToken.body()).thenReturn("{\"errcode\":0,\"access_token\":\"unit-token\",\"expires_in\":7200}");
        when(sendCard.statusCode()).thenReturn(200);
        when(sendCard.body()).thenReturn("{\"errcode\":0,\"msgid\":\"unit-card-14\"}");
        when(transport.send(any(HttpRequest.class), ArgumentMatchers.<HttpResponse.BodyHandler<String>>any()))
            .thenReturn(getToken, sendCard);
        var notice = Map.<String,Object>of("id", NOTICE, "task_id", TICKET, "wecom_userid", UID,
            "send_attempts", 0, "details", "处理原工单");
        when(db.optional(startsWith("SELECT n.*,p.wecom_userid"))).thenReturn(notice).thenReturn(null);
        var dispatcher = new NotificationService(db, gateway, manager, mock(Audit.class));
        assertEquals(Map.of("processed", 1, "accepted_by_api", 1, "failed_attempts", 0, "wecom_configured", true),
            dispatcher.dispatch());

        var requests = ArgumentCaptor.forClass(HttpRequest.class);
        verify(transport, times(2)).send(requests.capture(), ArgumentMatchers.<HttpResponse.BodyHandler<String>>any());
        assertEquals("/cgi-bin/gettoken", requests.getAllValues().get(0).uri().getPath());
        HttpRequest card = requests.getAllValues().get(1);
        assertEquals("/cgi-bin/message/send", card.uri().getPath());
        assertEquals("POST", card.method());
        JsonNode payload = new ObjectMapper().readTree(body(card));
        assertEquals("textcard", payload.path("msgtype").asText());
        assertEquals(UID, payload.path("touser").asText());
        assertEquals("https://socialtask.example.test/m/tasks/" + TICKET, payload.path("textcard").path("url").asText());
        verify(db).execute(startsWith("UPDATE notifications SET state='SENT'"), eq("unit-card-14"), eq(NOTICE));
    }

    private static String body(HttpRequest request) throws Exception {
        var result = new CompletableFuture<String>();
        request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<ByteBuffer>() {
            private final ByteArrayOutputStream output = new ByteArrayOutputStream();
            @Override public void onSubscribe(Flow.Subscription s) { s.request(Long.MAX_VALUE); }
            @Override public void onNext(ByteBuffer item) {
                byte[] buffer = new byte[item.remaining()];
                item.get(buffer);
                output.writeBytes(buffer);
            }
            @Override public void onError(Throwable failure) { result.completeExceptionally(failure); }
            @Override public void onComplete() { result.complete(output.toString(StandardCharsets.UTF_8)); }
        });
        return result.get(3, TimeUnit.SECONDS);
    }

    private static void identity(String role, Long person) {
        var principal = new RequestUser(1L, "unit-user", role, person);
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(principal, null, List.of()));
    }
}
