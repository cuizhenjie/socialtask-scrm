package com.socialtask.task;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.socialtask.common.*;
import org.springframework.dao.DuplicateKeyException;
import java.util.*;

/** Stores append-only revisions and resolves content against reviewed packages. */
final class TicketTemplateRepository {
    private static final ObjectMapper CONVERTER = new ObjectMapper();
    private final Db db;
    TicketTemplateRepository(Db db) { this.db = db; }

    TicketTemplate parse(Object value) {
        return CONVERTER.convertValue(value, TicketTemplate.class);
    }

    List<TicketTemplate> listCurrent() {
        return db.list("""
            SELECT t.schema_json FROM ticket_templates t
            WHERE t.version=(SELECT MAX(n.version) FROM ticket_templates n WHERE n.template_key=t.template_key)
            ORDER BY t.template_key
            """).stream().map(row -> parse(db.object(row.get("schema_json")))).toList();
    }

    TicketTemplate publish(String key, Integer expectedVersion, String title, List<TicketTemplate.Field> fields, long userId) {
        Db.badIf(expectedVersion == null || expectedVersion < 0 || expectedVersion == Integer.MAX_VALUE, "须提供合法的上一版本号");
        TicketTemplate next = new TicketTemplate(key,expectedVersion+1,title,fields);
        var previous = db.optional("SELECT MAX(version) latest FROM ticket_templates WHERE template_key=?",next.key());
        Object version = previous == null ? null : previous.get("latest");
        Db.ensure((version == null ? 0 : Db.n(version)) == expectedVersion,"模板版本已变化，请重新加载");
        try {
            db.insert("INSERT INTO ticket_templates(template_key,version,schema_json,published_by) VALUES(?,?,CAST(? AS jsonb),?)",
                next.key(),next.version(),db.json(next),userId);
        } catch(DuplicateKeyException e) { throw new ApiException(409,"模板版本已变化，请重新加载"); }
        return next;
    }

    TicketTemplate.Snapshot dispatch(String key, Integer version, Map<String,Object> values) {
        Db.badIf(version == null || version < 1 || key == null || key.isBlank(), "必须指定已发布的模板及版本");
        var row = db.one("SELECT schema_json FROM ticket_templates WHERE template_key=? AND version=?",key,version);
        return parse(db.object(row.get("schema_json"))).dispatch(values,this::material);
    }

    private TicketTemplate.Material material(long id) {
        var row = db.optional("SELECT id,title,body,hashtags,asset_ids_json FROM content_packages WHERE id=? AND review_status='APPROVED'",id);
        if(row == null) return null;
        Object raw = db.object("{\"assets\":"+row.get("asset_ids_json")+"}").get("assets");
        if(!(raw instanceof List<?> assets)) throw new IllegalStateException("素材附件格式不合法");
        List<Long> ids = assets.stream().map(Db::l).toList();
        return new TicketTemplate.Material(Db.id(row),Db.str(row.get("title")),Db.str(row.get("body")),Db.str(row.get("hashtags")),ids);
    }
}
