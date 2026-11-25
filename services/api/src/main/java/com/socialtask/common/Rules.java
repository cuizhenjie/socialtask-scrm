package com.socialtask.common;

import java.net.URI;
import java.time.*;
import java.util.*;

/** Pure Java domain rules. Runnable and testable without Spring or a database. */
public final class Rules {
    public static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    public static final Set<String> CONTACT_TYPES = Set.of("CONTACT_AUTHOR", "CONTACT_ASSISTANT", "FOLLOWUP");
    public static final Set<String> TERMINAL = Set.of("COMPLETED", "CANCELLED", "STOPPED");
    private Rules() {}

    private static boolean trustedHost(String h) { String x=h.toLowerCase(Locale.ROOT); return x.equals("douyin.com") || x.endsWith(".douyin.com") || x.equals("iesdouyin.com") || x.endsWith(".iesdouyin.com"); }
    public static String canonicalDouyin(String input) {
        try {
            URI url = URI.create(Objects.requireNonNull(input).trim());
            String host = url.getHost();
            if (!"https".equalsIgnoreCase(url.getScheme()) || host == null || !trustedHost(host))
                throw new IllegalArgumentException("仅允许 HTTPS 抖音作品链接");
            String path = url.getPath();
            if (path == null || path.isBlank() || path.equals("/")) throw new IllegalArgumentException("作品链接缺少路径");
            return "https://" + host.toLowerCase(Locale.ROOT) + path.replaceAll("/+$", "");
        } catch (RuntimeException error) { throw new IllegalArgumentException("作品链接格式无效：需 HTTPS 抖音作品地址"); }
    }
    public static String canonicalProfileDouyin(String input) {
        try {
            URI url=URI.create(Objects.requireNonNull(input).trim());
            String host=url.getHost();
            if(!"https".equalsIgnoreCase(url.getScheme()) || host==null || !trustedHost(host) || url.getUserInfo()!=null || url.getPath()==null || url.getPath().equals("/"))
                throw new IllegalArgumentException("需要有效抖音主页");
            return "https://"+host.toLowerCase(Locale.ROOT)+url.getPath().replaceAll("/+$","");
        }catch(RuntimeException e){throw new IllegalArgumentException("需要人工核验且为 HTTPS 的抖音账号主页");}
    }
    public static boolean maySubmit(String state) { return "PENDING".equals(state) || "REWORK".equals(state); }
    public static boolean mayReview(String state) { return "SUBMITTED".equals(state); }
    public static boolean mayRemind(String state, int count, int max) {
        return maySubmit(state) && count >= 0 && max > 0 && count < max;
    }
    public static boolean mayFollowup(String author, String assistant, String customerState,
                                      boolean hasConsent, boolean doNotContact, Instant firstFinishedAt, Instant now) {
        return hasConsent && !doNotContact && "NO_REPLY".equals(customerState)
            && "NO_REPLY".equals(author) && "NO_REPLY".equals(assistant)
            && firstFinishedAt != null && now != null
            && now.atZone(BUSINESS_ZONE).toLocalDate().isAfter(firstFinishedAt.atZone(BUSINESS_ZONE).toLocalDate());
    }
    public static boolean mustStopOther(String reply) { return "REPLIED".equals(reply) || "REFUSED".equals(reply); }
    public static void requirePermission(boolean allowed, boolean doNotContact, String basis) {
        if (!allowed || doNotContact || basis == null || basis.trim().length() < 4)
            throw new IllegalArgumentException("客户联系许可不足或已经拒绝联系");
    }
    public static int reminderLimit(String type) {
        return switch (type) { case "OFFICIAL_COMMENT" -> 5; case "PUBLISH" -> 10; default -> 3; };
    }
    public static String sanitizedIdentity(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("身份标识不能为空");
        return value.trim().toLowerCase(Locale.ROOT);
    }
}
