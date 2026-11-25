package com.socialtask.common;

import org.springframework.stereotype.Component;

@Component
public class Audit {
    private final Db db;
    public Audit(Db db){ this.db=db; }
    public void record(Long actor,String entity,long id,String action,Object after) {
        db.execute("INSERT INTO audit_logs(actor_user_id,entity,entity_id,action,after_json) VALUES(?,?,?,?,?)",
            actor,entity,Long.toString(id),action,after==null?null:db.json(after));
    }
}
