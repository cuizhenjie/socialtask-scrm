package com.socialtask.rules;
import com.socialtask.common.Rules;
import org.junit.jupiter.api.Test;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;

class RulesTest {
 @Test void allowsOnlyDouyinHttpsLinks() {
   assertEquals("https://www.douyin.com/video/999",Rules.canonicalDouyin("https://www.douyin.com/video/999?share=1"));
   assertThrows(IllegalArgumentException.class,()->Rules.canonicalDouyin("https://douyin.com.evil.org/video/999"));
   assertThrows(IllegalArgumentException.class,()->Rules.canonicalDouyin("http://www.douyin.com/video/999"));
 }
 @Test void reviewStatesAndReminderCountAreBounded() {
   assertTrue(Rules.maySubmit("REWORK"));assertFalse(Rules.maySubmit("COMPLETED"));
   assertFalse(Rules.mayReview("PENDING"));assertTrue(Rules.mayReview("SUBMITTED"));
   assertTrue(Rules.mayRemind("PENDING",2,3));assertFalse(Rules.mayRemind("PENDING",3,3));
 }
 @Test void nextDayGateRequiresUnansweredAndPermission() {
   Instant first=LocalDate.of(2026,11,22).atStartOfDay(Rules.BUSINESS_ZONE).toInstant();
   Instant next=first.plus(Duration.ofDays(1));
   assertTrue(Rules.mayFollowup("NO_REPLY","NO_REPLY","NO_REPLY",true,false,first,next));
   assertFalse(Rules.mayFollowup("NO_REPLY","REPLIED","NO_REPLY",true,false,first,next));
   assertFalse(Rules.mayFollowup("NO_REPLY","NO_REPLY","NO_REPLY",false,false,first,next));
 }
}
