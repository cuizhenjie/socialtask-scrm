-- V10: Privacy-compliant attachment retention and logical purge markers (preserves FK/audit history).
ALTER TABLE attachments
 ADD COLUMN retention_until TIMESTAMPTZ(3) NULL,
 ADD COLUMN purged_at TIMESTAMPTZ(3) NULL;
CREATE INDEX idx_attachments_retention ON attachments(purpose, purged_at, retention_until);
