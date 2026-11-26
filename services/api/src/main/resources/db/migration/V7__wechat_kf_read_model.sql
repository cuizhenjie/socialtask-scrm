-- Separate customer-service identity space. No people/customer auto-binding and no raw external IDs.
CREATE TABLE kf_sync_state (
 account_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 cursor_value VARCHAR(1024) NULL,
 has_more BOOLEAN NOT NULL DEFAULT FALSE,
 last_attempt_at DATETIME(3) NULL,last_sync_at DATETIME(3) NULL,
 lease_id VARCHAR(36) NULL,lease_until DATETIME(3) NULL,last_error VARCHAR(200) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE kf_messages (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 account_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 peer_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 message_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 origin INT NOT NULL,message_type VARCHAR(32) NOT NULL,content TEXT NULL,message_at DATETIME(3) NOT NULL,
 recalled BOOLEAN NOT NULL DEFAULT FALSE,recall_target_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 FOREIGN KEY(account_key) REFERENCES kf_sync_state(account_key),
 INDEX idx_kf_peer(account_key,peer_key,message_at),
 INDEX idx_kf_recall(account_key,peer_key,recall_target_key),
 INDEX idx_kf_retention(message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
