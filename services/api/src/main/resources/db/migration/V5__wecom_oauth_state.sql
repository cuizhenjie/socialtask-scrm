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
