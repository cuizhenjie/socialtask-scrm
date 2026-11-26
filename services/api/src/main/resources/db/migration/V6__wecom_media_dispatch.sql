ALTER TABLE wecom_messages ADD COLUMN provider_media_id VARCHAR(512) NULL,
 ADD COLUMN request_fingerprint CHAR(64) CHARACTER SET ascii NULL,
 ADD COLUMN media_filename VARCHAR(120) NULL,
 ADD COLUMN media_bytes INT NULL;
-- Old RETRY/SENDING rows may already have reached WeCom; require human reconciliation.
UPDATE notifications SET state='UNKNOWN',last_error='历史发送结果未知，请人工核对'
 WHERE state IN ('RETRY','SENDING');
