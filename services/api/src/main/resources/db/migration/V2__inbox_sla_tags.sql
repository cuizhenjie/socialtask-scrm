-- v1.1: real WeCom internal application inbox, configurable ticket SLA, people groups/tags (PostgreSQL / Supabase).
CREATE TABLE people_groups (
 id BIGSERIAL PRIMARY KEY,
 name VARCHAR(100) NOT NULL UNIQUE,
 description VARCHAR(300) NOT NULL DEFAULT '',
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO people_groups(name) VALUES ('第一组'),('第二组'),('第三组') ON CONFLICT (name) DO NOTHING;
INSERT INTO people_groups(name) SELECT DISTINCT group_name FROM people WHERE group_name IS NOT NULL AND group_name<>'' ON CONFLICT (name) DO NOTHING;

CREATE TABLE tags (
 id BIGSERIAL PRIMARY KEY,
 name VARCHAR(60) NOT NULL UNIQUE,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE people_tag_links (
 person_id BIGINT NOT NULL REFERENCES people(id),
 tag_id BIGINT NOT NULL REFERENCES tags(id),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(person_id, tag_id)
);
CREATE INDEX idx_people_tag ON people_tag_links(tag_id, person_id);
CREATE INDEX idx_people_wecom_userid ON people(wecom_userid);

CREATE TABLE sla_policies (
 id BIGSERIAL PRIMARY KEY,
 name VARCHAR(120) NOT NULL,
 task_type VARCHAR(35) NOT NULL DEFAULT 'ALL',
 priority VARCHAR(12) NOT NULL DEFAULT 'NORMAL',
 response_minutes INT NOT NULL,
 resolution_minutes INT NOT NULL,
 response_warning_minutes INT NOT NULL DEFAULT 30,
 resolution_warning_minutes INT NOT NULL DEFAULT 60,
 calendar_mode VARCHAR(16) NOT NULL DEFAULT '24X7',
 timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
 business_start CHAR(5) NOT NULL DEFAULT '09:00',
 business_end CHAR(5) NOT NULL DEFAULT '18:00',
 working_days VARCHAR(30) NOT NULL DEFAULT '1,2,3,4,5',
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT uq_sla_scope UNIQUE(task_type, priority)
);
CREATE TRIGGER trg_sla_policies_updated_at BEFORE UPDATE ON sla_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO sla_policies (name,task_type,priority,response_minutes,resolution_minutes,calendar_mode,response_warning_minutes,resolution_warning_minutes)
 VALUES('默认工单 SLA','ALL','NORMAL',120,1440,'24X7',30,60),
       ('高优先级工单 SLA','ALL','HIGH',60,480,'24X7',15,45),
       ('紧急工单 SLA','ALL','URGENT',15,120,'24X7',5,30);

CREATE TABLE task_sla (
 task_id BIGINT PRIMARY KEY REFERENCES tasks(id),
 policy_id BIGINT NOT NULL REFERENCES sla_policies(id),
 response_due_at TIMESTAMPTZ(3) NOT NULL,
 resolution_due_at TIMESTAMPTZ(3) NOT NULL,
 first_response_at TIMESTAMPTZ(3) NULL,
 resolved_at TIMESTAMPTZ(3) NULL,
 response_breached_at TIMESTAMPTZ(3) NULL,
 resolution_breached_at TIMESTAMPTZ(3) NULL,
 response_warned_at TIMESTAMPTZ(3) NULL,
 resolution_warned_at TIMESTAMPTZ(3) NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_response_due ON task_sla(response_due_at, first_response_at);
CREATE INDEX idx_resolution_due ON task_sla(resolution_due_at, resolved_at);
CREATE TRIGGER trg_task_sla_updated_at BEFORE UPDATE ON task_sla FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tasks ADD COLUMN priority VARCHAR(12) NOT NULL DEFAULT 'NORMAL';

-- A historical task is attached to the default SLA without altering its original due date.
INSERT INTO task_sla(task_id,policy_id,response_due_at,resolution_due_at,first_response_at,resolved_at)
SELECT t.id, s.id,
       t.created_at + (s.response_minutes * INTERVAL '1 minute'),
       t.created_at + (s.resolution_minutes * INTERVAL '1 minute'),
       (SELECT MIN(submitted_at) FROM task_submissions ts WHERE ts.task_id=t.id),
       CASE WHEN t.status='COMPLETED' THEN t.updated_at ELSE NULL END
FROM tasks t JOIN sla_policies s ON s.task_type='ALL' AND s.priority='NORMAL';

UPDATE task_sla s
SET response_breached_at=CASE WHEN s.first_response_at>s.response_due_at THEN s.first_response_at ELSE NULL END,
    resolution_breached_at=CASE WHEN s.resolved_at>s.resolution_due_at THEN s.resolved_at ELSE NULL END
FROM tasks t WHERE t.id=s.task_id;

-- Only internal employee messages addressed to this self-built application. Not WeCom customer chat archive.
CREATE TABLE wecom_conversations (
 id BIGSERIAL PRIMARY KEY,
 channel VARCHAR(32) NOT NULL DEFAULT 'WECOM_APP',
 peer_userid VARCHAR(128) NOT NULL,
 person_id BIGINT NULL REFERENCES people(id),
 unread_count INT NOT NULL DEFAULT 0,
 last_message_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT uq_wecom_conversation UNIQUE(channel, peer_userid)
);

CREATE TABLE wecom_messages (
 id BIGSERIAL PRIMARY KEY,
 conversation_id BIGINT NOT NULL REFERENCES wecom_conversations(id),
 msg_key CHAR(64) NOT NULL UNIQUE,
 direction VARCHAR(12) NOT NULL,
 message_type VARCHAR(32) NOT NULL,
 content TEXT NULL,
 provider_msgid VARCHAR(160) NULL,
 message_at TIMESTAMPTZ(3) NOT NULL,
 delivery_status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_inbox_recent ON wecom_messages(conversation_id, message_at);

ALTER TABLE notifications ADD COLUMN provider_msgid VARCHAR(160) NULL;
ALTER TABLE tasks ADD COLUMN source_message_id BIGINT NULL;
ALTER TABLE tasks ADD CONSTRAINT fk_task_source_message FOREIGN KEY(source_message_id) REFERENCES wecom_messages(id);
CREATE INDEX idx_task_reporting ON tasks(type, status, priority, created_at);
ALTER TABLE notifications ADD COLUMN attempted_at TIMESTAMPTZ(3) NULL;
