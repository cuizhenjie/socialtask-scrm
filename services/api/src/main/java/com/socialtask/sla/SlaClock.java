package com.socialtask.sla;

import java.time.*;
import java.util.*;

/** Pure calendar arithmetic. Calendar exceptions are explicitly configured local dates, not inferred holidays. */
public final class SlaClock {
    private SlaClock() {}
    private static final long MAX_MILLIS=Duration.ofMinutes(525600).toMillis();
    private static final int MAX_DAYS=6000;

    public record CalendarSpec(String mode,ZoneId zone,LocalTime opens,LocalTime closes,Set<Integer> weekdays,Set<LocalDate> closed,Set<LocalDate> extraWorking) {
        public CalendarSpec {
            weekdays=Set.copyOf(weekdays);closed=Set.copyOf(closed);extraWorking=Set.copyOf(extraWorking);
        }
        private boolean businessDay(LocalDate day){
            return !closed.contains(day)&&(extraWorking.contains(day)||weekdays.contains(day.getDayOfWeek().getValue()));
        }
        public Instant addMillis(Instant start,long millis){
            if(start==null||millis<0||millis>MAX_MILLIS)throw new IllegalArgumentException("SLA 时长超出范围");
            if(millis==0)return start;
            if("24X7".equals(mode))return start.plusMillis(millis);
            Instant cursor=start;long remaining=millis;
            for(int day=0;day<MAX_DAYS;day++){
                LocalDate date=cursor.atZone(zone).toLocalDate();
                if(businessDay(date)){
                    Instant from=date.atTime(opens).atZone(zone).toInstant(),to=date.atTime(closes).atZone(zone).toInstant();
                    Instant beginAt=cursor.isAfter(from)?cursor:from;
                    if(beginAt.isBefore(to)){
                        long available=Duration.between(beginAt,to).toMillis();
                        if(remaining<=available)return beginAt.plusMillis(remaining);
                        remaining-=available;
                    }
                }
                cursor=date.plusDays(1).atStartOfDay(zone).toInstant();
            }
            throw new IllegalArgumentException("SLA 配置的日历无法在可计算范围内完成目标");
        }
        public long workingMillis(Instant start,Instant end){
            if(start==null||end==null||end.isBefore(start))throw new IllegalArgumentException("SLA 时间区间无效");
            if("24X7".equals(mode))return Duration.between(start,end).toMillis();
            LocalDate date=start.atZone(zone).toLocalDate();long sum=0;
            for(int day=0;day<MAX_DAYS;day++,date=date.plusDays(1)){
                Instant dayStart=date.atStartOfDay(zone).toInstant();
                if(!dayStart.isBefore(end))return sum;
                if(!businessDay(date))continue;
                Instant from=date.atTime(opens).atZone(zone).toInstant(),to=date.atTime(closes).atZone(zone).toInstant();
                if(from.isBefore(start))from=start;if(to.isAfter(end))to=end;
                if(from.isBefore(to))sum=Math.addExact(sum,Duration.between(from,to).toMillis());
            }
            throw new IllegalArgumentException("SLA 时间区间超出可计算范围");
        }
    }
    public static CalendarSpec calendar(String mode,String timezone,String begin,String end,String workingDays,String closedDates,String openDates){
        Set<LocalDate> closed=parseDates(closedDates),opened=parseDates(openDates);
        if(!Collections.disjoint(closed,opened))throw new IllegalArgumentException("同一天不可同时设置休息与调休工作");
        if("24X7".equals(mode)){
            if(!closed.isEmpty()||!opened.isEmpty())throw new IllegalArgumentException("7×24 模式不能设置工作日例外");
            return new CalendarSpec(mode,ZoneOffset.UTC,LocalTime.MIDNIGHT,LocalTime.MAX,Set.of(),Set.of(),Set.of());
        }
        if(!"BUSINESS_HOURS".equals(mode))throw new IllegalArgumentException("SLA 日历类型无效");
        ZoneId zone=ZoneId.of(timezone);LocalTime opens=LocalTime.parse(begin),closes=LocalTime.parse(end);
        if(!closes.isAfter(opens))throw new IllegalArgumentException("营业结束时间应晚于开始时间");
        return new CalendarSpec(mode,zone,opens,closes,parseDays(workingDays),closed,opened);
    }
    public static Instant deadline(Instant start,int minutes,String mode,String timezone,String begin,String end,String workingDays){
        return deadline(start,minutes,mode,timezone,begin,end,workingDays,"","");
    }
    public static Instant deadline(Instant start,int minutes,String mode,String timezone,String begin,String end,String workingDays,String closedDates,String openDates){
        if(start==null||minutes<1||minutes>525600)throw new IllegalArgumentException("SLA 目标分钟须在 1 至 525600 之间");
        return calendar(mode,timezone,begin,end,workingDays,closedDates,openDates).addMillis(start,Duration.ofMinutes(minutes).toMillis());
    }
    public static Set<Integer> parseDays(String weekdays){
        if(weekdays==null||!weekdays.matches("[1-7](,[1-7]){0,6}"))throw new IllegalArgumentException("工作日填写 1-7，使用逗号分隔");
        Set<Integer> set=new HashSet<>();
        for(String text:weekdays.split(","))if(!set.add(Integer.parseInt(text)))throw new IllegalArgumentException("工作日重复");
        return set;
    }
    public static Set<LocalDate> parseDates(String raw){
        Set<LocalDate> dates=new TreeSet<>();
        if(raw==null||raw.isBlank())return dates;
        if(raw.length()>12000)throw new IllegalArgumentException("例外日过多");
        for(String part:raw.strip().split("[,\\s，]+")){
            if(!part.matches("\\d{4}-\\d{2}-\\d{2}"))throw new IllegalArgumentException("例外日期须为 YYYY-MM-DD");
            if(!dates.add(LocalDate.parse(part))||dates.size()>730)throw new IllegalArgumentException("例外日期重复或超过 730 天");
        }
        return dates;
    }
    public static List<Integer> escalationSteps(String raw){
        if(raw==null||raw.isBlank())return List.of();
        if(raw.length()>80)throw new IllegalArgumentException("升级规则过长");
        List<Integer> result=new ArrayList<>();int last=0;
        for(String part:raw.strip().split("[,\\s，]+")){
            if(!part.matches("\\d{1,5}"))throw new IllegalArgumentException("升级时长须为整数分钟");
            int n=Integer.parseInt(part);
            if(n<=last||n>43200||result.size()>=5)throw new IllegalArgumentException("最多五级升级，分钟数严格递增且不超过 43200");
            result.add(n);last=n;
        }
        return List.copyOf(result);
    }
}
