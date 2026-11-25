package com.socialtask.rules;
import com.socialtask.common.Rules;
import java.time.*;

/** No dependencies or services needed. Run via scripts/check-domain.sh. */
public class RulesOfflineTest {
  private static int passed = 0;
  private static void yes(boolean ok, String label) { if (!ok) throw new AssertionError(label); passed++; }
  public static void main(String[] ignored) {
    yes(Rules.canonicalDouyin("https://www.douyin.com/video/123?foo=1").equals("https://www.douyin.com/video/123"),"normalize work URL");
    try { Rules.canonicalDouyin("http://evil.com/video/123"); throw new AssertionError("host policy"); } catch (IllegalArgumentException expected) { passed++; }
    yes(Rules.maySubmit("REWORK") && !Rules.maySubmit("SUBMITTED"),"submission transition");
    yes(Rules.mayReview("SUBMITTED") && !Rules.mayReview("PENDING"),"review transition");
    yes(Rules.mustStopOther("REPLIED") && Rules.mustStopOther("REFUSED") && !Rules.mustStopOther("NO_REPLY"),"stop contact");
    yes(Rules.mayRemind("PENDING", 1, 3) && !Rules.mayRemind("PENDING", 3, 3),"reminder cap");
    Instant today = LocalDate.of(2026,11,24).atStartOfDay(Rules.BUSINESS_ZONE).toInstant();
    Instant previous = today.minusSeconds(3600);
    yes(Rules.mayFollowup("NO_REPLY","NO_REPLY","NO_REPLY",true,false,previous,today),"next day only");
    yes(!Rules.mayFollowup("NO_REPLY","NO_REPLY","NO_REPLY",true,false,today,today),"same day forbidden");
    yes(!Rules.mayFollowup("NO_REPLY","NO_REPLY","RESPONDED",true,false,previous,today),"answered stops followup");
    yes(!Rules.mayFollowup("NO_REPLY","NO_REPLY","NO_REPLY",true,true,previous,today),"do not contact");
    try { Rules.requirePermission(false,false,"主动咨询"); throw new AssertionError("consent"); } catch (IllegalArgumentException expected) { passed++; }
    yes(Rules.reminderLimit("OFFICIAL_COMMENT") == 5 && Rules.reminderLimit("PUBLISH") == 10,"type limits");
    yes(Rules.canonicalProfileDouyin("https://www.douyin.com/user/123?share=1").equals("https://www.douyin.com/user/123"),"normalize customer profile");
    yes(Rules.sanitizedIdentity(" A_B-123 ").equals("a_b-123"),"normalize verified customer ID");
    yes(!Rules.mayRemind("COMPLETED", 0, 5) && !Rules.mayRemind("STOPPED", 0, 5),"stop reminders on terminal task");
    try { Rules.canonicalProfileDouyin("https://notdouyin.com/user/123"); throw new AssertionError("profile host policy"); } catch (IllegalArgumentException expected) { passed++; }
    System.out.println("PASS "+passed+" pure-domain assertions");
  }
}
