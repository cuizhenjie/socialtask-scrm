CREATE TABLE ticket_templates (
 id BIGSERIAL PRIMARY KEY,
 template_key VARCHAR(40) NOT NULL,
 version INT NOT NULL,
 schema_json JSONB NOT NULL,
 published_by BIGINT NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT uq_ticket_template_revision UNIQUE(template_key, version)
);

CREATE TABLE ticket_material_assets (
 task_id BIGINT NOT NULL REFERENCES tasks(id),
 attachment_id BIGINT NOT NULL REFERENCES attachments(id),
 PRIMARY KEY(task_id, attachment_id)
);
CREATE INDEX ix_ticket_material_attachment ON ticket_material_assets(attachment_id, task_id);
