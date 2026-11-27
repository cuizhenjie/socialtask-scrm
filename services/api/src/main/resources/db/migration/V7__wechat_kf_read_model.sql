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
