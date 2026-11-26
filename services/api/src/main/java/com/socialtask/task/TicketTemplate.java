package com.socialtask.task;

import com.socialtask.common.ApiException;
import java.net.URI;
import java.util.*;
import java.util.function.LongFunction;
import java.util.regex.Pattern;

/** Immutable service-ticket schema and the validation shared by creation and submission. */
public record TicketTemplate(String key, int version, String title, List<Field> fields) {
    public enum Phase { DISPATCH, RESPONSE }
    public enum Kind { TEXT, HTTPS_URL, CHECKBOX, MATERIAL_PACKAGE }
    public record Field(String key, String label, Phase phase, Kind kind, boolean required) {}
    public record Material(long id, String title, String body, String hashtags, List<Long> assetIds) {
        public Material { assetIds = List.copyOf(assetIds); }
    }
    public record Snapshot(TicketTemplate template, Map<String,Object> values) {
        public Snapshot { values = Map.copyOf(values); }
        public Set<Long> assetIds() {
            Set<Long> ids = new LinkedHashSet<>();
            for (Object value : values.values()) if (value instanceof Material m) ids.addAll(m.assetIds());
            return ids;
        }
    }

    private static final Pattern KEY = Pattern.compile("[a-z][a-z0-9_]{0,39}");

    public TicketTemplate {
        invalid(key == null || !KEY.matcher(key).matches(), "模板标识不合法");
        invalid(version < 1, "模板版本不合法");
        title = text(title, "模板名称", 100);
        invalid(fields == null || fields.isEmpty() || fields.size() > 30, "字段数量须为 1–30");
        Set<String> seen = new HashSet<>();
        List<Field> clean = new ArrayList<>();
        for (Field field : fields) {
            invalid(field == null || field.key() == null || !KEY.matcher(field.key()).matches(), "字段标识不合法");
            invalid(!seen.add(field.key()), "字段标识重复：" + field.key());
            invalid(field.phase() == null || field.kind() == null, "字段阶段或类型不合法");
            invalid(field.phase() == Phase.RESPONSE && field.kind() == Kind.MATERIAL_PACKAGE, "素材包字段只能用于下发");
            clean.add(new Field(field.key(), text(field.label(), "字段名称", 100), field.phase(), field.kind(), field.required()));
        }
        fields = List.copyOf(clean);
    }

    public Snapshot dispatch(Map<?,?> input, LongFunction<Material> approvedPackage) {
        return new Snapshot(this, validate(Phase.DISPATCH, input, approvedPackage));
    }

    public Map<String,Object> response(Map<?,?> input) {
        return validate(Phase.RESPONSE, input, null);
    }

    private Map<String,Object> validate(Phase phase, Map<?,?> input, LongFunction<Material> materials) {
        Map<?,?> provided = input == null ? Map.of() : input;
        List<Field> expected = fields.stream().filter(f -> f.phase() == phase).toList();
        for (Object key : provided.keySet())
            invalid(expected.stream().noneMatch(f -> f.key().equals(key)), "存在未配置的字段");
        Map<String,Object> result = new LinkedHashMap<>();
        for (Field field : expected) {
            Object value = provided.get(field.key());
            if (value == null || value instanceof String s && s.isBlank()) {
                invalid(field.required(), field.label() + "为必填");
                continue;
            }
            Object typed = switch (field.kind()) {
                case TEXT -> text(value, field.label(), 3000);
                case HTTPS_URL -> url(value, field.label());
                case CHECKBOX -> {
                    invalid(!(value instanceof Boolean), field.label() + "须为布尔值");
                    yield value;
                }
                case MATERIAL_PACKAGE -> {
                    invalid(!(value instanceof Integer || value instanceof Long) || ((Number)value).longValue() <= 0,
                            field.label() + "须引用合法素材包 ID");
                    long id = ((Number)value).longValue();
                    Material material = materials.apply(id);
                    invalid(material == null || material.id() != id, field.label() + "须引用已审核通过的素材包");
                    yield material;
                }
            };
            result.put(field.key(), typed);
        }
        return Collections.unmodifiableMap(result);
    }

    private static String text(Object value, String label, int max) {
        invalid(!(value instanceof String s) || s.isBlank() || s.strip().length() > max, label + "为空、过长或类型不合法");
        return ((String)value).strip();
    }

    private static String url(Object value, String label) {
        String raw = text(value,label,2000);
        try {
            URI uri = URI.create(raw);
            if ("https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && uri.getRawUserInfo() == null) return raw;
        } catch (IllegalArgumentException ignored) {}
        throw new ApiException(400,label + "须为 HTTPS 链接");
    }

    private static void invalid(boolean condition, String message) {
        if (condition) throw new ApiException(400,message);
    }
}
