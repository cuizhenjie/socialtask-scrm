-- SocialTask Supabase bootstrap (PostgreSQL / Supabase Data API).
-- Run ONCE in Supabase Dashboard → SQL Editor (role: postgres), on an empty database.
-- It contains the full schema (previously Flyway V1–V11) plus the PostgREST RPC gateway.
-- The Spring Boot API no longer connects over JDBC: it calls /rest/v1/rpc/api_query and
-- /rest/v1/rpc/api_exec with SUPABASE_SERVICE_ROLE_KEY. That key must stay server-side.

-- >>>>> V1__baseline.sql
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

-- >>>>> V2__inbox_sla_tags.sql
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

-- >>>>> V3__customer_segmentation.sql
-- v1.1 customer segmentation is separate from performer/person tags (PostgreSQL / Supabase).
CREATE TABLE customer_segments (
 id BIGSERIAL PRIMARY KEY,
 name VARCHAR(100) NOT NULL UNIQUE,
 description VARCHAR(300) NOT NULL DEFAULT '',
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO customer_segments(name,description)
 VALUES ('未分组','默认客户分组'),('重点意向','管理员人工确认'),('常规咨询','一般咨询客户'),('待人工核验','身份或线索待核实')
 ON CONFLICT (name) DO NOTHING;

ALTER TABLE customers ADD COLUMN segment_id BIGINT NULL;
ALTER TABLE customers ADD CONSTRAINT fk_customer_segment FOREIGN KEY(segment_id) REFERENCES customer_segments(id);
UPDATE customers SET segment_id=(SELECT id FROM customer_segments WHERE name='未分组') WHERE segment_id IS NULL;
CREATE INDEX idx_customer_segment ON customers(segment_id, status);

CREATE TABLE customer_tags (
 id BIGSERIAL PRIMARY KEY,
 name VARCHAR(60) NOT NULL UNIQUE,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customer_tag_links (
 customer_id BIGINT NOT NULL REFERENCES customers(id),
 tag_id BIGINT NOT NULL REFERENCES customer_tags(id),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(customer_id, tag_id)
);
CREATE INDEX idx_customer_tag ON customer_tag_links(tag_id, customer_id);

-- >>>>> V4__ticket_templates.sql
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

-- >>>>> V5__wecom_oauth_state.sql
-- Browser-bound, short-lived, one-time OAuth attempts; no code or bearer token is persisted here.
CREATE TABLE wecom_oauth_states (
 state_hash CHAR(64) PRIMARY KEY,
 browser_hash CHAR(64) NOT NULL,
 return_path VARCHAR(32) NULL,
 expires_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX idx_wecom_oauth_expiry ON wecom_oauth_states(expires_at);

-- Existing password sessions retain their semantics. Only OAuth sessions are revoked on rebind.
ALTER TABLE sessions ADD COLUMN auth_method VARCHAR(16) NOT NULL DEFAULT 'PASSWORD';

-- >>>>> V6__wecom_media_dispatch.sql
ALTER TABLE wecom_messages
 ADD COLUMN provider_media_id VARCHAR(512) NULL,
 ADD COLUMN request_fingerprint CHAR(64) NULL,
 ADD COLUMN media_filename VARCHAR(120) NULL,
 ADD COLUMN media_bytes INT NULL;

-- Old RETRY/SENDING rows may already have reached WeCom; require human reconciliation.
UPDATE notifications SET state='UNKNOWN', last_error='历史发送结果未知，请人工核对'
 WHERE state IN ('RETRY','SENDING');

-- >>>>> V7__wechat_kf_read_model.sql
-- Separate customer-service identity space. No people/customer auto-binding and no raw external IDs.
CREATE TABLE kf_sync_state (
 account_key CHAR(64) PRIMARY KEY,
 cursor_value VARCHAR(1024) NULL,
 has_more BOOLEAN NOT NULL DEFAULT FALSE,
 last_attempt_at TIMESTAMPTZ(3) NULL,
 last_sync_at TIMESTAMPTZ(3) NULL,
 lease_id VARCHAR(36) NULL,
 lease_until TIMESTAMPTZ(3) NULL,
 last_error VARCHAR(200) NULL
);

CREATE TABLE kf_messages (
 id BIGSERIAL PRIMARY KEY,
 account_key CHAR(64) NOT NULL REFERENCES kf_sync_state(account_key),
 peer_key CHAR(64) NULL,
 message_key CHAR(64) NOT NULL UNIQUE,
 origin INT NOT NULL,
 message_type VARCHAR(32) NOT NULL,
 content TEXT NULL,
 message_at TIMESTAMPTZ(3) NOT NULL,
 recalled BOOLEAN NOT NULL DEFAULT FALSE,
 recall_target_key CHAR(64) NULL
);
CREATE INDEX idx_kf_peer ON kf_messages(account_key, peer_key, message_at);
CREATE INDEX idx_kf_recall ON kf_messages(account_key, peer_key, recall_target_key);
CREATE INDEX idx_kf_retention ON kf_messages(message_at);

-- >>>>> V8__sla_calendar_pause_escalation.sql
ALTER TABLE sla_policies
 ADD COLUMN closed_dates TEXT NULL,
 ADD COLUMN open_dates TEXT NULL,
 ADD COLUMN escalation_minutes VARCHAR(80) NOT NULL DEFAULT '';

ALTER TABLE task_sla
 ADD COLUMN calendar_snapshot JSONB NULL,
 ADD COLUMN response_warning_minutes INT NOT NULL DEFAULT 30,
 ADD COLUMN resolution_warning_minutes INT NOT NULL DEFAULT 60,
 ADD COLUMN escalation_minutes VARCHAR(80) NOT NULL DEFAULT '',
 ADD COLUMN paused_at TIMESTAMPTZ(3) NULL,
 ADD COLUMN pause_reason VARCHAR(300) NULL,
 ADD COLUMN response_remaining_ms BIGINT NULL,
 ADD COLUMN resolution_remaining_ms BIGINT NULL,
 ADD COLUMN pause_count INT NOT NULL DEFAULT 0,
 ADD COLUMN paused_total_ms BIGINT NOT NULL DEFAULT 0,
 ADD COLUMN response_escalation_level INT NOT NULL DEFAULT 0,
 ADD COLUMN resolution_escalation_level INT NOT NULL DEFAULT 0,
 ADD COLUMN next_response_escalation_at TIMESTAMPTZ(3) NULL,
 ADD COLUMN next_resolution_escalation_at TIMESTAMPTZ(3) NULL;

-- Existing due dates and historical breach flags are not changed. Historical calendar revisions before V8 cannot be reconstructed.
UPDATE task_sla s
SET calendar_snapshot = jsonb_build_object(
      'calendar_mode', p.calendar_mode,
      'timezone', p.timezone,
      'business_start', p.business_start,
      'business_end', p.business_end,
      'working_days', p.working_days,
      'closed_dates', COALESCE(p.closed_dates, ''),
      'open_dates', COALESCE(p.open_dates, '')
    ),
    response_warning_minutes = p.response_warning_minutes,
    resolution_warning_minutes = p.resolution_warning_minutes,
    escalation_minutes = p.escalation_minutes
FROM sla_policies p
WHERE p.id = s.policy_id;

CREATE INDEX idx_sla_escalate_response ON task_sla(next_response_escalation_at);
CREATE INDEX idx_sla_escalate_resolution ON task_sla(next_resolution_escalation_at);

-- >>>>> V9__llm_profile.sql
-- One administrator-managed service-side model profile. No cleartext API keys.
CREATE TABLE llm_profile (
 id INT PRIMARY KEY CHECK (id=1),
 version INT NOT NULL CHECK (version>=1),
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 endpoint VARCHAR(1024) NOT NULL,
 model_id VARCHAR(160) NOT NULL,
 key_cipher TEXT NULL,
 updated_by BIGINT NOT NULL REFERENCES users(id),
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER trg_llm_profile_updated_at BEFORE UPDATE ON llm_profile FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- >>>>> V10__attachment_retention.sql
-- V10: Privacy-compliant attachment retention and logical purge markers (preserves FK/audit history).
ALTER TABLE attachments
 ADD COLUMN retention_until TIMESTAMPTZ(3) NULL,
 ADD COLUMN purged_at TIMESTAMPTZ(3) NULL;
CREATE INDEX idx_attachments_retention ON attachments(purpose, purged_at, retention_until);

-- >>>>> V11__supabase_rls.sql
-- V11: Supabase security hardening (Volcengine Ark Agent Plan Supabase / PostgreSQL).
-- Enable RLS on all public schema tables and deny direct anon/authenticated Data API access;
-- SocialTask Spring Boot API accesses PostgreSQL directly with server-side RBAC.
DO $$
DECLARE
 tbl RECORD;
BEGIN
 -- 只处理当前角色拥有的对象：Supabase 的 public schema 可能含有平台创建的表
 -- （例如 health_check，owner 为 supabase_admin），对它们执行 ALTER 会报 42501。
 FOR tbl IN
  SELECT c.relname AS name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND pg_get_userbyid(c.relowner) = current_user
    AND c.relname <> 'flyway_schema_history'
 LOOP
  BEGIN
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.name);
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl.name);
   END IF;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl.name);
   END IF;
  EXCEPTION WHEN insufficient_privilege THEN
   RAISE NOTICE '跳过 RLS/权限收紧（当前角色不是 % 的 owner）', tbl.name;
  END;
 END LOOP;

 FOR tbl IN
  SELECT c.relname AS name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'S'
    AND pg_get_userbyid(c.relowner) = current_user
 LOOP
  BEGIN
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', tbl.name);
   END IF;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM authenticated', tbl.name);
   END IF;
  EXCEPTION WHEN insufficient_privilege THEN
   RAISE NOTICE '跳过序列权限收紧：%', tbl.name;
  END;
 END LOOP;
END
$$;

-- =====================================================================
-- PostgREST RPC gateway (service_role only)
-- =====================================================================
-- api_query: runs a SELECT, or a DML statement with RETURNING, and returns rows as jsonb.
-- api_exec : runs a DML statement without RETURNING and returns the affected row count.
-- Both are SECURITY DEFINER and pinned to search_path=public; execute is revoked from
-- PUBLIC/anon/authenticated so browsers can never reach them with the anon key.
CREATE OR REPLACE FUNCTION public.api_query(p_sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  statement text := btrim(p_sql, E' \t\r\n;');
  head text;
  result jsonb;
BEGIN
  IF statement IS NULL OR statement = '' THEN
    RETURN '[]'::jsonb;
  END IF;
  head := upper(left(statement, 12));
  IF head LIKE 'INSERT%' OR head LIKE 'UPDATE%' OR head LIKE 'DELETE%' OR head LIKE 'MERGE%'
     OR (head LIKE 'WITH%' AND upper(statement) LIKE '%RETURNING %') THEN
    EXECUTE 'WITH __dml AS (' || statement || ') SELECT coalesce(jsonb_agg(to_jsonb(__dml)), ''[]''::jsonb) FROM __dml'
      INTO result;
  ELSE
    EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(__q)), ''[]''::jsonb) FROM (' || statement || ') __q'
      INTO result;
  END IF;
  RETURN coalesce(result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_exec(p_sql text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected integer;
BEGIN
  EXECUTE btrim(p_sql, E' \t\r\n;');
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.api_query(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_exec(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.api_query(text) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.api_exec(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.api_query(text) FROM authenticated;
    REVOKE EXECUTE ON FUNCTION public.api_exec(text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT EXECUTE ON FUNCTION public.api_query(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.api_exec(text) TO service_role;
  END IF;
END
$$;
