package com.socialtask.common;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Component;
import java.sql.*;
import java.time.*;
import java.util.*;

@Component
public class Db {
    public final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public Db(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc=jdbc; this.json=json; }

    public List<Map<String,Object>> list(String sql, Object...args) { return jdbc.queryForList(sql,args); }
    public Map<String,Object> optional(String sql, Object...args) {
        var result = list(sql,args);
        return result.isEmpty()?null:result.getFirst();
    }
    public Map<String,Object> one(String sql, Object...args) {
        var result = optional(sql,args);
        if (result==null) throw new ApiException(404,"记录不存在");
        return result;
    }
    public int execute(String sql, Object...args) { return jdbc.update(sql,args); }
    public long insert(String sql, Object...args) {
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement statement=con.prepareStatement(sql,Statement.RETURN_GENERATED_KEYS);
            for (int i=0;i<args.length;i++) statement.setObject(i+1,args[i]);
            return statement;
        },keys);
        if (keys.getKey()==null) throw new IllegalStateException("INSERT 未返回主键");
        return keys.getKey().longValue();
    }
    public static long id(Map<String,Object> row) { return ((Number)row.get("id")).longValue(); }
    public static long l(Object value) { return ((Number)value).longValue(); }
    public static int n(Object value) { return ((Number)value).intValue(); }
    public static boolean bool(Object value) { return value instanceof Boolean b ? b : value instanceof Number n && n.intValue()!=0; }
    public static String str(Object value) { return value==null ? null : value.toString(); }
    public static Timestamp stamp(Instant instant) { return Timestamp.from(instant); }
    public static Instant instant(Object value) {
        if (value==null) return null;
        if (value instanceof Timestamp t) return t.toInstant();
        if (value instanceof LocalDateTime t) return t.toInstant(ZoneOffset.UTC);
        if (value instanceof java.util.Date) return ((java.util.Date)value).toInstant();
        return Instant.parse(value.toString());
    }
    public String json(Object object) { try { return json.writeValueAsString(object); } catch(Exception e) { throw new IllegalArgumentException("JSON 编码失败",e); } }
    public Map<String,Object> object(Object value) {
        if (value==null) return new LinkedHashMap<>();
        try { return json.readValue(value.toString(),new TypeReference<>(){}); }
        catch(Exception e) { throw new IllegalArgumentException("JSON 数据解析失败",e); }
    }
    public static String required(String value,String label,int max) {
        if(value==null || value.isBlank() || value.strip().length()>max) throw new ApiException(400,label+"不能为空或过长");
        return value.strip();
    }
    public static void ensure(boolean condition,String message) { if(!condition) throw new ApiException(409,message); }
    public static void badIf(boolean condition,String message) { if(condition) throw new ApiException(400,message); }
}
