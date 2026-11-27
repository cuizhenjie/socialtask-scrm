package com.socialtask.common;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.*;
import java.time.format.DateTimeParseException;
import java.util.*;

/**
 * Supabase 数据访问层（PostgREST，无 JDBC）。
 *
 * <p>所有 SQL 都通过 HTTPS 调用 Supabase Data API 暴露的两个只读/写入网关函数：
 * {@code api_query(sql) -> jsonb} 与 {@code api_exec(sql) -> int}。服务端进程使用
 * {@code SUPABASE_SERVICE_ROLE_KEY} 鉴权，该密钥只存在于 API 服务器环境变量中，
 * 永远不会下发到浏览器；浏览器只使用 anon 密钥访问自己的业务接口。</p>
 *
 * <p>SQL 仍保留原先的 {@code ?} 占位符写法，参数在发送前按 PostgreSQL 字面量规则转义后内联，
 * 因此 267 处调用点无需改写。每次调用是独立的 HTTP 请求，也是一个独立的数据库事务。</p>
 */
@Component
public class Db {
    private final ObjectMapper json;
    private final HttpClient http;
    private final String rpcBase;
    private final String apiKey;

    public Db(ObjectMapper json,
              @Value("${app.supabase.url:}") String url,
              @Value("${app.supabase.service-role-key:}") String serviceRoleKey,
              @Value("${app.supabase.rpc-path:/rest/v1/rpc}") String rpcPath) {
        this.json = json;
        String base = url == null ? "" : url.strip().replaceAll("/+$", "");
        String path = rpcPath == null || rpcPath.isBlank() ? "/rest/v1/rpc" : rpcPath.strip();
        if (!path.startsWith("/")) path = "/" + path;
        path = path.replaceAll("/+$", "");
        this.rpcBase = base.isEmpty() ? "" : base + path + "/";
        this.apiKey = serviceRoleKey == null ? "" : serviceRoleKey.strip();
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    /** 当前数据网关是否已配置（用于健康检查/测试跳过）。 */
    public boolean configured() { return !rpcBase.isEmpty() && !apiKey.isEmpty(); }

    public List<Map<String,Object>> list(String sql, Object...args) {
        String body = call("api_query", Map.of("p_sql", bind(sql, args)));
        if (body == null || body.isBlank()) return new ArrayList<>();
        try {
            List<Map<String,Object>> rows = json.readValue(body, new TypeReference<>() {});
            if (rows == null) return new ArrayList<>();
            // 与 JDBC 行为保持一致：jsonb 列以 JSON 文本返回，而不是嵌套对象/数组。
            for (Map<String,Object> row : rows) {
                for (Map.Entry<String,Object> entry : row.entrySet()) {
                    Object value = entry.getValue();
                    if (value instanceof Map<?,?> || value instanceof Collection<?>) entry.setValue(json(value));
                }
            }
            return rows;
        } catch (Exception e) {
            throw new IllegalStateException("数据网关返回格式错误", e);
        }
    }

    public Map<String,Object> optional(String sql, Object...args) {
        List<Map<String,Object>> rows = list(sql, args);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    public Map<String,Object> one(String sql, Object...args) {
        Map<String,Object> row = optional(sql, args);
        if (row == null) throw new ApiException(404, "记录不存在");
        return row;
    }

    public int execute(String sql, Object...args) {
        String body = call("api_exec", Map.of("p_sql", bind(sql, args)));
        if (body == null || body.isBlank()) return 0;
        try {
            return Integer.parseInt(body.strip());
        } catch (NumberFormatException e) {
            throw new IllegalStateException("数据网关返回格式错误", e);
        }
    }

    public long insert(String sql, Object...args) {
        String statement = sql.strip();
        if (!statement.toUpperCase(Locale.ROOT).contains("RETURNING")) {
            statement = statement.replaceAll(";\\s*$", "") + " RETURNING id";
        }
        List<Map<String,Object>> rows = list(statement, args);
        if (rows.isEmpty() || rows.getFirst().get("id") == null) throw new IllegalStateException("INSERT 未返回主键");
        return ((Number) rows.getFirst().get("id")).longValue();
    }

    private String call(String function, Map<String,Object> payload) {
        if (!configured()) {
            throw new ApiException(503, "未配置 Supabase 数据网关：请设置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY");
        }
        final String requestBody;
        try {
            requestBody = json.writeValueAsString(payload);
        } catch (Exception e) {
            throw new IllegalArgumentException("请求序列化失败", e);
        }
        HttpRequest request = HttpRequest.newBuilder(URI.create(rpcBase + function))
            .timeout(Duration.ofSeconds(60))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("apikey", apiKey)
            .header("Authorization", "Bearer " + apiKey)
            .POST(HttpRequest.BodyPublishers.ofString(requestBody, StandardCharsets.UTF_8))
            .build();
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() / 100 != 2) {
                String body = response.body();
                // 保留原先 JDBC 时代的错误语义：唯一键冲突映射为 409，约束冲突映射为 409。
                String sqlState = sqlState(body);
                if ("23505".equals(sqlState)) throw new org.springframework.dao.DuplicateKeyException(abbreviate(body));
                if (sqlState != null && sqlState.startsWith("23")) throw new org.springframework.dao.DataIntegrityViolationException(abbreviate(body));
                throw new ApiException(502, "Supabase 数据网关返回 " + response.statusCode() + "：" + abbreviate(body));
            }
            return response.body();
        } catch (java.io.IOException e) {
            throw new ApiException(502, "Supabase 数据网关不可用：" + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(502, "Supabase 数据网关调用被中断");
        }
    }

    /** PostgREST 在错误体里返回 PostgreSQL SQLSTATE（如 23505 唯一键冲突）。 */
    private String sqlState(String body) {
        if (body == null || body.isBlank()) return null;
        try {
            var node = json.readTree(body).path("code");
            return node.isTextual() ? node.asText() : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String abbreviate(String text) {
        if (text == null) return "";
        String flat = text.replaceAll("\\s+", " ").strip();
        return flat.length() <= 300 ? flat : flat.substring(0, 300) + "…";
    }

    /**
     * 将 JDBC 风格的 {@code ?} 占位符替换为经过转义的 PostgreSQL 字面量。
     * 扫描时会跳过单引号/双引号字符串，避免误替换字符串内部的问号。
     */
    static String bind(String sql, Object...args) {
        StringBuilder out = new StringBuilder(sql.length() + 32);
        int index = 0;
        char quote = 0;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (quote != 0) {
                out.append(c);
                if (c == quote) {
                    if (i + 1 < sql.length() && sql.charAt(i + 1) == quote) {
                        out.append(sql.charAt(++i));
                    } else {
                        quote = 0;
                    }
                }
                continue;
            }
            if (c == '\'' || c == '"') {
                quote = c;
                out.append(c);
                continue;
            }
            if (c == '?') {
                if (index >= args.length) throw new IllegalArgumentException("SQL 占位符数量多于参数数量");
                out.append(literal(args[index++]));
                continue;
            }
            out.append(c);
        }
        if (index != args.length) throw new IllegalArgumentException("SQL 占位符数量与参数数量不一致");
        return out.toString();
    }

    private static String literal(Object value) {
        if (value == null) return "NULL";
        if (value instanceof String text) return "'" + text.replace("'", "''") + "'";
        if (value instanceof Boolean flag) return flag ? "TRUE" : "FALSE";
        if (value instanceof Number number) return number.toString();
        if (value instanceof Timestamp stamp) return "'" + stamp.toInstant() + "'::timestamptz";
        if (value instanceof Instant instant) return "'" + instant + "'::timestamptz";
        if (value instanceof LocalDate date) return "'" + date + "'::date";
        if (value instanceof java.util.Date date) return "'" + date.toInstant() + "'::timestamptz";
        if (value instanceof byte[] bytes) return "'\\x" + HexFormat.of().formatHex(bytes) + "'::bytea";
        if (value instanceof Map<?,?> || value instanceof Collection<?>) {
            throw new IllegalArgumentException("请先用 db.json(...) 把集合转换为 JSON 字符串再作为参数传入");
        }
        return "'" + value.toString().replace("'", "''") + "'";
    }

    public static long id(Map<String,Object> row) { return ((Number)row.get("id")).longValue(); }
    public static long l(Object value) { return ((Number)value).longValue(); }
    public static int n(Object value) { return ((Number)value).intValue(); }
    public static boolean bool(Object value) { return value instanceof Boolean b ? b : value instanceof Number n && n.intValue() != 0; }
    public static String str(Object value) { return value == null ? null : value.toString(); }
    public static Timestamp stamp(Instant instant) { return instant == null ? null : Timestamp.from(instant); }
    public static Instant instant(Object value) {
        if (value == null) return null;
        if (value instanceof Timestamp t) return t.toInstant();
        if (value instanceof OffsetDateTime t) return t.toInstant();
        if (value instanceof LocalDateTime t) return t.toInstant(ZoneOffset.UTC);
        if (value instanceof java.util.Date date) return date.toInstant();
        if (value instanceof Instant instant) return instant;
        String text = value.toString();
        try { return Instant.parse(text); } catch (DateTimeParseException ignored) { }
        try { return OffsetDateTime.parse(text).toInstant(); } catch (DateTimeParseException ignored) { }
        try { return LocalDateTime.parse(text).toInstant(ZoneOffset.UTC); } catch (DateTimeParseException ignored) { }
        return Instant.parse(text);
    }
    public String json(Object object) {
        try { return json.writeValueAsString(object); }
        catch (Exception e) { throw new IllegalArgumentException("JSON 编码失败", e); }
    }
    public Map<String,Object> object(Object value) {
        if (value == null) return new LinkedHashMap<>();
        if (value instanceof Map<?,?> map) {
            Map<String,Object> copy = new LinkedHashMap<>();
            map.forEach((key, item) -> copy.put(String.valueOf(key), item));
            return copy;
        }
        try { return json.readValue(value.toString(), new TypeReference<>() {}); }
        catch (Exception e) { throw new IllegalArgumentException("JSON 数据解析失败", e); }
    }
    public static String required(String value,String label,int max) {
        if(value==null || value.isBlank() || value.strip().length()>max) throw new ApiException(400,label+"不能为空或过长");
        return value.strip();
    }
    public static void ensure(boolean condition,String message) { if(!condition) throw new ApiException(409,message); }
    public static void badIf(boolean condition,String message) { if(condition) throw new ApiException(400,message); }
}
