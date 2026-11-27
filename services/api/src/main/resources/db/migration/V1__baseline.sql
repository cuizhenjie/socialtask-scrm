-- V1: SocialTask transactional baseline for Volcengine Ark Agent Plan Supabase (PostgreSQL).
-- All timestamps are UTC TIMESTAMPTZ(3); client renders local time.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
 NEW.updated_at = CURRENT_TIMESTAMP;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE people (
 id BIGSERIAL PRIMARY KEY,
 person_no VARCHAR(40) NOT NULL UNIQUE,
 name VARCHAR(120) NOT NULL,
 person_type VARCHAR(32) NOT NULL,
 group_name VARCHAR(100) NOT NULL DEFAULT '第一组',
 wecom_userid VARCHAR(120),
 identity_type VARCHAR(40) NOT NULL DEFAULT '合作账号',
 status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_person_type_group ON people(person_type, group_name);

CREATE TABLE users (
 id BIGSERIAL PRIMARY KEY,
 username VARCHAR(80) NOT NULL UNIQUE,
 password_hash VARCHAR(120) NOT NULL,
 role VARCHAR(32) NOT NULL,
 person_id BIGINT NULL REFERENCES people(id),
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id),
 token_hash CHAR(64) NOT NULL UNIQUE,
 expires_at TIMESTAMPTZ(3) NOT NULL,
 revoked BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE social_accounts (
 id BIGSERIAL PRIMARY KEY,
 person_id BIGINT NOT NULL REFERENCES people(id),
 platform VARCHAR(32) NOT NULL DEFAULT 'douyin',
 nickname VARCHAR(160) NOT NULL,
 external_uid VARCHAR(160),
 profile_url VARCHAR(600) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_social_account_uid ON social_accounts(platform, external_uid);

CREATE TABLE attachments (
 id BIGSERIAL PRIMARY KEY,
 owner_user_id BIGINT NOT NULL REFERENCES users(id),
 purpose VARCHAR(40) NOT NULL,
 filename VARCHAR(220) NOT NULL,
 storage_key CHAR(64) NOT NULL UNIQUE,
 mime VARCHAR(60) NOT NULL,
 file_size BIGINT NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE content_packages (
 id BIGSERIAL PRIMARY KEY,
 title VARCHAR(220) NOT NULL,
 body TEXT NOT NULL,
 hashtags VARCHAR(700) NOT NULL DEFAULT '',
 asset_ids_json JSONB NOT NULL,
 review_status VARCHAR(25) NOT NULL DEFAULT 'DRAFT',
 created_by BIGINT NOT NULL REFERENCES users(id),
 reviewed_by BIGINT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE publish_batches (
 id BIGSERIAL PRIMARY KEY,
 title VARCHAR(200) NOT NULL,
 content_id BIGINT NOT NULL REFERENCES content_packages(id),
 deadline_at TIMESTAMPTZ(3) NOT NULL,
 created_by BIGINT NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customers (
 id BIGSERIAL PRIMARY KEY,
 customer_no VARCHAR(48) NOT NULL UNIQUE,
 nickname VARCHAR(160) NOT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'NEW',
 contact_allowed BOOLEAN NOT NULL DEFAULT FALSE,
 consent_basis VARCHAR(500),
 do_not_contact BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_customer_status ON customers(status);

CREATE TABLE customer_identities (
 id BIGSERIAL PRIMARY KEY,
 customer_id BIGINT NOT NULL REFERENCES customers(id),
 platform VARCHAR(30) NOT NULL,
 identity_kind VARCHAR(25) NOT NULL,
 identity_hash CHAR(64) NOT NULL,
 verified BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT uq_identity UNIQUE(platform, identity_kind, identity_hash)
);

CREATE TABLE contact_rounds (
 id BIGSERIAL PRIMARY KEY,
 customer_id BIGINT NOT NULL REFERENCES customers(id),
 round_no INT NOT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT uq_customer_round UNIQUE(customer_id, round_no)
);

CREATE TABLE tasks (
 id BIGSERIAL PRIMARY KEY,
 task_no VARCHAR(48) NOT NULL UNIQUE,
 title VARCHAR(240) NOT NULL,
 type VARCHAR(35) NOT NULL,
 status VARCHAR(25) NOT NULL DEFAULT 'PENDING',
 assignee_id BIGINT NOT NULL REFERENCES people(id),
 batch_id BIGINT NULL REFERENCES publish_batches(id),
 work_id BIGINT NULL,
 customer_id BIGINT NULL REFERENCES customers(id),
 round_id BIGINT NULL REFERENCES contact_rounds(id),
 due_at TIMESTAMPTZ(3) NOT NULL,
 payload_json JSONB NOT NULL,
 reminder_interval INT NOT NULL DEFAULT 60,
 reminder_max INT NOT NULL DEFAULT 10,
 reminder_count INT NOT NULL DEFAULT 0,
 next_remind_at TIMESTAMPTZ(3) NULL,
 overdue_at TIMESTAMPTZ(3) NULL,
 version INT NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_task_due ON tasks(status, next_remind_at);
CREATE INDEX idx_task_assignee ON tasks(assignee_id, status);
CREATE INDEX idx_task_round ON tasks(round_id);
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE works (
 id BIGSERIAL PRIMARY KEY,
 task_id BIGINT NOT NULL UNIQUE REFERENCES tasks(id),
 author_person_id BIGINT NOT NULL REFERENCES people(id),
 work_url VARCHAR(1500) NOT NULL,
 url_hash CHAR(64) NOT NULL UNIQUE,
 verify_status VARCHAR(25) NOT NULL DEFAULT 'PENDING',
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE tasks ADD CONSTRAINT fk_task_work FOREIGN KEY(work_id) REFERENCES works(id);

CREATE TABLE comments (
 id BIGSERIAL PRIMARY KEY,
 work_id BIGINT NOT NULL REFERENCES works(id),
 nickname VARCHAR(160) NOT NULL,
 external_uid VARCHAR(160),
 content TEXT NOT NULL,
 category VARCHAR(40) NOT NULL DEFAULT '其他',
 status VARCHAR(25) NOT NULL DEFAULT 'PENDING',
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_comment_work ON comments(work_id);

CREATE TABLE customer_sources (
 id BIGSERIAL PRIMARY KEY,
 customer_id BIGINT NOT NULL REFERENCES customers(id),
 work_id BIGINT NOT NULL REFERENCES works(id),
 comment_id BIGINT NULL REFERENCES comments(id),
 source_key VARCHAR(120) NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT uq_customer_source UNIQUE(customer_id, source_key)
);

CREATE TABLE task_submissions (
 id BIGSERIAL PRIMARY KEY,
 task_id BIGINT NOT NULL REFERENCES tasks(id),
 actor_user_id BIGINT NOT NULL REFERENCES users(id),
 revision INT NOT NULL,
 payload_json JSONB NOT NULL,
 attachment_id BIGINT NULL REFERENCES attachments(id),
 review_status VARCHAR(25) NOT NULL DEFAULT 'PENDING',
 submitted_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT uq_task_revision UNIQUE(task_id, revision)
);

CREATE TABLE contact_attempts (
 id BIGSERIAL PRIMARY KEY,
 round_id BIGINT NOT NULL REFERENCES contact_rounds(id),
 task_id BIGINT NOT NULL UNIQUE REFERENCES tasks(id),
 person_id BIGINT NOT NULL REFERENCES people(id),
 reply_status VARCHAR(25) NOT NULL,
 attachment_id BIGINT NOT NULL REFERENCES attachments(id),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
 id BIGSERIAL PRIMARY KEY,
 event_key VARCHAR(170) NOT NULL UNIQUE,
 task_id BIGINT NULL REFERENCES tasks(id),
 person_id BIGINT NULL REFERENCES people(id),
 event_type VARCHAR(40) NOT NULL,
 state VARCHAR(30) NOT NULL DEFAULT 'PENDING',
 details VARCHAR(800) NOT NULL DEFAULT '',
 send_attempts INT NOT NULL DEFAULT 0,
 last_error VARCHAR(500),
 sent_at TIMESTAMPTZ(3) NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notification_status ON notifications(state, created_at);

CREATE TABLE audit_logs (
 id BIGSERIAL PRIMARY KEY,
 actor_user_id BIGINT NULL REFERENCES users(id),
 entity VARCHAR(60) NOT NULL,
 entity_id VARCHAR(80) NOT NULL,
 action VARCHAR(70) NOT NULL,
 before_json JSONB NULL,
 after_json JSONB NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
