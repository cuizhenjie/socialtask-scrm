-- v1.1: real WeCom internal application inbox, configurable ticket SLA, people groups/tags.
-- Upgrade only: do not edit V1 or rewrite historical tasks.
CREATE TABLE people_groups (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 name VARCHAR(100) NOT NULL UNIQUE,
 description VARCHAR(300) NOT NULL DEFAULT '',
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO people_groups(name) VALUES ('第一组'),('第二组'),('第三组');
INSERT IGNORE INTO people_groups(name) SELECT DISTINCT group_name FROM people WHERE group_name IS NOT NULL AND group_name<>'';
CREATE TABLE tags (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(60) NOT NULL UNIQUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE people_tag_links (
 person_id BIGINT NOT NULL,tag_id BIGINT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(person_id,tag_id),
 FOREIGN KEY(person_id) REFERENCES people(id),
 FOREIGN KEY(tag_id) REFERENCES tags(id),
 INDEX idx_people_tag(tag_id,person_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_people_wecom_userid ON people(wecom_userid);

CREATE TABLE sla_policies (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
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
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_sla_scope(task_type,priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO sla_policies (name,task_type,priority,response_minutes,resolution_minutes,calendar_mode,response_warning_minutes,resolution_warning_minutes)
 VALUES('默认工单 SLA','ALL','NORMAL',120,1440,'24X7',30,60),
       ('高优先级工单 SLA','ALL','HIGH',60,480,'24X7',15,45),
       ('紧急工单 SLA','ALL','URGENT',15,120,'24X7',5,30);
CREATE TABLE task_sla (
 task_id BIGINT PRIMARY KEY,
 policy_id BIGINT NOT NULL,
 response_due_at DATETIME(3) NOT NULL,
 resolution_due_at DATETIME(3) NOT NULL,
 first_response_at DATETIME(3) NULL,
 resolved_at DATETIME(3) NULL,
 response_breached_at DATETIME(3) NULL,
 resolution_breached_at DATETIME(3) NULL,
 response_warned_at DATETIME(3) NULL,
 resolution_warned_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 FOREIGN KEY(task_id) REFERENCES tasks(id),
 FOREIGN KEY(policy_id) REFERENCES sla_policies(id),
 INDEX idx_response_due(response_due_at,first_response_at),
 INDEX idx_resolution_due(resolution_due_at,resolved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE tasks ADD COLUMN priority VARCHAR(12) NOT NULL DEFAULT 'NORMAL';
-- A historical task is attached to the default SLA without altering its original due date.
INSERT INTO task_sla(task_id,policy_id,response_due_at,resolution_due_at,first_response_at,resolved_at)
SELECT t.id,s.id, DATE_ADD(t.created_at,INTERVAL s.response_minutes MINUTE),
       DATE_ADD(t.created_at,INTERVAL s.resolution_minutes MINUTE),
       (SELECT MIN(submitted_at) FROM task_submissions ts WHERE ts.task_id=t.id),
       CASE WHEN t.status='COMPLETED' THEN t.updated_at ELSE NULL END
FROM tasks t JOIN sla_policies s ON s.task_type='ALL' AND s.priority='NORMAL';
UPDATE task_sla s JOIN tasks t ON t.id=s.task_id
SET s.response_breached_at=CASE WHEN s.first_response_at>s.response_due_at THEN s.first_response_at ELSE NULL END,
    s.resolution_breached_at=CASE WHEN s.resolved_at>s.resolution_due_at THEN s.resolved_at ELSE NULL END;


-- Only internal employee messages addressed to this self-built application. Not WeCom customer chat archive.
CREATE TABLE wecom_conversations (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 channel VARCHAR(32) NOT NULL DEFAULT 'WECOM_APP',
 peer_userid VARCHAR(128) NOT NULL,
 person_id BIGINT NULL,
 unread_count INT NOT NULL DEFAULT 0,
 last_message_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_wecom_conversation(channel,peer_userid),
 FOREIGN KEY(person_id) REFERENCES people(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE wecom_messages (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 conversation_id BIGINT NOT NULL,
 msg_key CHAR(64) CHARACTER SET ascii NOT NULL UNIQUE,
 direction VARCHAR(12) NOT NULL,
 message_type VARCHAR(32) NOT NULL,
 content TEXT NULL,
 provider_msgid VARCHAR(160) NULL,
 message_at DATETIME(3) NOT NULL,
 delivery_status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(conversation_id) REFERENCES wecom_conversations(id),
 INDEX idx_inbox_recent(conversation_id,message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE notifications ADD COLUMN provider_msgid VARCHAR(160) NULL;
ALTER TABLE tasks ADD COLUMN source_message_id BIGINT NULL;
ALTER TABLE tasks ADD CONSTRAINT fk_task_source_message FOREIGN KEY(source_message_id) REFERENCES wecom_messages(id);
CREATE INDEX idx_task_reporting ON tasks(type,status,priority,created_at);
ALTER TABLE notifications ADD COLUMN attempted_at DATETIME(3) NULL;
