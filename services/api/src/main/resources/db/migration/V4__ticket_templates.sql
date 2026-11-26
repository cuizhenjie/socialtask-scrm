CREATE TABLE ticket_templates (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    version INT NOT NULL,
    schema_json JSON NOT NULL,
    published_by BIGINT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_ticket_template_revision(template_key,version),
    FOREIGN KEY(published_by) REFERENCES users(id)
);

CREATE TABLE ticket_material_assets (
    task_id BIGINT NOT NULL,
    attachment_id BIGINT NOT NULL,
    PRIMARY KEY(task_id,attachment_id),
    KEY ix_ticket_material_attachment(attachment_id,task_id),
    FOREIGN KEY(task_id) REFERENCES tasks(id),
    FOREIGN KEY(attachment_id) REFERENCES attachments(id)
);
