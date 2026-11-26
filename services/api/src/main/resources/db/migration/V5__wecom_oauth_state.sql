-- Browser-bound, short-lived, one-time OAuth attempts; no code or bearer token is persisted here.
CREATE TABLE wecom_oauth_states (
 state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 browser_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 return_path VARCHAR(32) NULL,
 expires_at DATETIME(3) NOT NULL,
 INDEX idx_wecom_oauth_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Existing password sessions retain their semantics. Only OAuth sessions are revoked on rebind.
ALTER TABLE sessions ADD COLUMN auth_method VARCHAR(16) NOT NULL DEFAULT 'PASSWORD';
