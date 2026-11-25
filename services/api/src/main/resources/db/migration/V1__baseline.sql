-- V1: SocialTask transactional baseline. All time values are UTC; client renders local time.
CREATE TABLE people (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, person_no VARCHAR(40) NOT NULL UNIQUE,
 name VARCHAR(120) NOT NULL, person_type VARCHAR(32) NOT NULL,
 group_name VARCHAR(100) NOT NULL DEFAULT '第一组', wecom_userid VARCHAR(120),
 identity_type VARCHAR(40) NOT NULL DEFAULT '合作账号', status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX idx_person_type_group(person_type, group_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE users (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, username VARCHAR(80) NOT NULL UNIQUE,
 password_hash VARCHAR(120) NOT NULL, role VARCHAR(32) NOT NULL,
 person_id BIGINT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), FOREIGN KEY (person_id) REFERENCES people(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE sessions (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, user_id BIGINT NOT NULL,
 token_hash CHAR(64) CHARACTER SET ascii NOT NULL UNIQUE, expires_at DATETIME(3) NOT NULL,
 revoked BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(user_id) REFERENCES users(id), INDEX idx_sessions_user(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE social_accounts (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, person_id BIGINT NOT NULL, platform VARCHAR(32) NOT NULL DEFAULT 'douyin',
 nickname VARCHAR(160) NOT NULL, external_uid VARCHAR(160), profile_url VARCHAR(600) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(person_id) REFERENCES people(id), INDEX idx_social_account_uid(platform,external_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE attachments (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, owner_user_id BIGINT NOT NULL,
 purpose VARCHAR(40) NOT NULL, filename VARCHAR(220) NOT NULL,
 storage_key CHAR(64) CHARACTER SET ascii NOT NULL UNIQUE, mime VARCHAR(60) NOT NULL,
 file_size BIGINT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE content_packages (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, title VARCHAR(220) NOT NULL, body TEXT NOT NULL,
 hashtags VARCHAR(700) NOT NULL DEFAULT '', asset_ids_json JSON NOT NULL,
 review_status VARCHAR(25) NOT NULL DEFAULT 'DRAFT', created_by BIGINT NOT NULL,
 reviewed_by BIGINT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(created_by) REFERENCES users(id), FOREIGN KEY(reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE publish_batches (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, title VARCHAR(200) NOT NULL,
 content_id BIGINT NOT NULL, deadline_at DATETIME(3) NOT NULL,
 created_by BIGINT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(content_id) REFERENCES content_packages(id), FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE customers (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, customer_no VARCHAR(48) NOT NULL UNIQUE,
 nickname VARCHAR(160) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'NEW',
 contact_allowed BOOLEAN NOT NULL DEFAULT FALSE, consent_basis VARCHAR(500),
 do_not_contact BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX idx_customer_status(status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE customer_identities (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, customer_id BIGINT NOT NULL,
 platform VARCHAR(30) NOT NULL, identity_kind VARCHAR(25) NOT NULL,
 identity_hash CHAR(64) CHARACTER SET ascii NOT NULL,
 verified BOOLEAN NOT NULL DEFAULT TRUE, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_identity(platform,identity_kind,identity_hash),
 FOREIGN KEY(customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE contact_rounds (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, customer_id BIGINT NOT NULL, round_no INT NOT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_customer_round(customer_id,round_no), FOREIGN KEY(customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE tasks (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, task_no VARCHAR(48) NOT NULL UNIQUE,
 title VARCHAR(240) NOT NULL, type VARCHAR(35) NOT NULL,
 status VARCHAR(25) NOT NULL DEFAULT 'PENDING', assignee_id BIGINT NOT NULL,
 batch_id BIGINT NULL, work_id BIGINT NULL, customer_id BIGINT NULL, round_id BIGINT NULL,
 due_at DATETIME(3) NOT NULL, payload_json JSON NOT NULL,
 reminder_interval INT NOT NULL DEFAULT 60, reminder_max INT NOT NULL DEFAULT 10,
 reminder_count INT NOT NULL DEFAULT 0, next_remind_at DATETIME(3) NULL,
 overdue_at DATETIME(3) NULL, version INT NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 FOREIGN KEY(assignee_id) REFERENCES people(id), FOREIGN KEY(batch_id) REFERENCES publish_batches(id),
 FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(round_id) REFERENCES contact_rounds(id),
 INDEX idx_task_due(status,next_remind_at), INDEX idx_task_assignee(assignee_id,status), INDEX idx_task_round(round_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE works (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, task_id BIGINT NOT NULL UNIQUE, author_person_id BIGINT NOT NULL,
 work_url VARCHAR(1500) NOT NULL, url_hash CHAR(64) CHARACTER SET ascii NOT NULL UNIQUE,
 verify_status VARCHAR(25) NOT NULL DEFAULT 'PENDING', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(task_id) REFERENCES tasks(id), FOREIGN KEY(author_person_id) REFERENCES people(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE tasks ADD CONSTRAINT fk_task_work FOREIGN KEY(work_id) REFERENCES works(id);
CREATE TABLE comments (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, work_id BIGINT NOT NULL,
 nickname VARCHAR(160) NOT NULL, external_uid VARCHAR(160), content TEXT NOT NULL,
 category VARCHAR(40) NOT NULL DEFAULT '其他', status VARCHAR(25) NOT NULL DEFAULT 'PENDING',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(work_id) REFERENCES works(id), INDEX idx_comment_work(work_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE customer_sources (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, customer_id BIGINT NOT NULL,
 work_id BIGINT NOT NULL, comment_id BIGINT NULL, source_key VARCHAR(120) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_customer_source(customer_id,source_key),
 FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(work_id) REFERENCES works(id), FOREIGN KEY(comment_id) REFERENCES comments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE task_submissions (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, task_id BIGINT NOT NULL, actor_user_id BIGINT NOT NULL,
 revision INT NOT NULL, payload_json JSON NOT NULL,
 attachment_id BIGINT NULL, review_status VARCHAR(25) NOT NULL DEFAULT 'PENDING',
 submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_task_revision(task_id,revision), FOREIGN KEY(task_id) REFERENCES tasks(id),
 FOREIGN KEY(actor_user_id) REFERENCES users(id), FOREIGN KEY(attachment_id) REFERENCES attachments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE contact_attempts (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, round_id BIGINT NOT NULL, task_id BIGINT NOT NULL UNIQUE,
 person_id BIGINT NOT NULL, reply_status VARCHAR(25) NOT NULL, attachment_id BIGINT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(round_id) REFERENCES contact_rounds(id), FOREIGN KEY(task_id) REFERENCES tasks(id),
 FOREIGN KEY(person_id) REFERENCES people(id), FOREIGN KEY(attachment_id) REFERENCES attachments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE notifications (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, event_key VARCHAR(170) NOT NULL UNIQUE,
 task_id BIGINT NULL, person_id BIGINT NULL, event_type VARCHAR(40) NOT NULL,
 state VARCHAR(30) NOT NULL DEFAULT 'PENDING', details VARCHAR(800) NOT NULL DEFAULT '',
 send_attempts INT NOT NULL DEFAULT 0, last_error VARCHAR(500),
 sent_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(task_id) REFERENCES tasks(id), FOREIGN KEY(person_id) REFERENCES people(id),
 INDEX idx_notification_status(state,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE audit_logs (
 id BIGINT PRIMARY KEY AUTO_INCREMENT, actor_user_id BIGINT NULL,
 entity VARCHAR(60) NOT NULL, entity_id VARCHAR(80) NOT NULL,
 action VARCHAR(70) NOT NULL, before_json JSON NULL, after_json JSON NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(actor_user_id) REFERENCES users(id), INDEX idx_audit_entity(entity,entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
