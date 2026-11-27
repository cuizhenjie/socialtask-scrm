-- V10: Privacy-compliant attachment retention and logical purge markers (preserves FK/audit history).
ALTER TABLE attachments
 ADD COLUMN retention_until DATETIME(3) NULL AFTER created_at,
 ADD COLUMN purged_at DATETIME(3) NULL AFTER retention_until,
 ADD INDEX idx_attachments_retention(purpose, purged_at, retention_until);
