package com.socialtask.sla;

import java.time.*;
import java.util.*;

/** Pure Java SLA calendar arithmetic: response/resolution clocks are independent of task due_at. */
public final class SlaClock {
    private SlaClock() {}
    public static Instant deadline(Instant start,int minutes,String mode,String timezone,String begin,String end,String workingDays) {
        if(start==null || minutes<1 || minutes>525600) throw new IllegalArgumentException("SLA 目标分钟须在 1 至 525600 之间");
        if("24X7".equals(mode)) return start.plus(Duration.ofMinutes(minutes));
        if(!"BUSINESS_HOURS".equals(mode)) throw new IllegalArgumentException("SLA 日历类型无效");
        ZoneId zone=ZoneId.of(timezone);
        LocalTime opens=LocalTime.parse(begin), closes=LocalTime.parse(end);
        if(!closes.isAfter(opens)) throw new IllegalArgumentException("营业结束时间应晚于开始时间");
        Set<Integer> weekdays=parseDays(workingDays);
        Instant cursor=start;
        long remaining=Duration.ofMinutes(minutes).toMillis();
        // Up to 15 years; large budgets in a 5x9 schedule are still bounded and deterministic.
        for(int day=0;day<6000;day++) {
            LocalDate date=cursor.atZone(zone).toLocalDate();
            if(weekdays.contains(date.getDayOfWeek().getValue())) {
                Instant from=date.atTime(opens).atZone(zone).toInstant();
                Instant to=date.atTime(closes).atZone(zone).toInstant();
                Instant beginAt=cursor.isAfter(from)?cursor:from;
                if(beginAt.isBefore(to)) {
                    long available=Duration.between(beginAt,to).toMillis();
                    if(remaining<=available) return beginAt.plusMillis(remaining);
                    remaining-=available;
                }
            }
            cursor=date.plusDays(1).atStartOfDay(zone).toInstant();
        }
        throw new IllegalArgumentException("SLA 配置的日历无法在可计算范围内完成目标");
    }
    public static Set<Integer> parseDays(String weekdays) {
        if(weekdays==null || !weekdays.matches("[1-7](,[1-7]){0,6}")) throw new IllegalArgumentException("工作日填写 1-7，使用逗号分隔");
        Set<Integer> set=new HashSet<>();
        for(String text:weekdays.split(",")) if(!set.add(Integer.parseInt(text))) throw new IllegalArgumentException("工作日重复");
        return set;
    }
}
