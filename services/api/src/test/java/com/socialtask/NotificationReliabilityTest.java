package com.socialtask;
import com.socialtask.common.*;
import com.socialtask.notification.*;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class NotificationReliabilityTest {
 @Test void ambiguousCardFailureIsQuarantinedWithoutRetry()throws Exception{
    Db db=mock(Db.class);WecomGateway gateway=mock(WecomGateway.class);
    PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenAnswer(i->new SimpleTransactionStatus());
    when(db.optional(startsWith("SELECT n.*,p.wecom_userid"))).thenReturn(Map.of("id",1L,"task_id",2L,"wecom_userid","unit","details","unit ticket")).thenReturn(null);
    when(gateway.configured()).thenReturn(true);
    when(gateway.sendTextCard("unit","SocialTask 任务通知","unit ticket",2L)).thenThrow(new java.io.IOException("unit-secret-never-persist"));
    var service=new NotificationService(db,gateway,manager,mock(Audit.class));
    assertEquals(1,service.dispatch().get("failed_attempts"));
    verify(gateway,times(1)).sendTextCard("unit","SocialTask 任务通知","unit ticket",2L);
    verify(db).execute(contains("attempted_at<DATE_SUB"));
    verify(db).execute(startsWith("UPDATE notifications SET state='UNKNOWN',last_error='发送结果未知"),eq(1L));
 }
}
