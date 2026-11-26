-- One administrator-managed service-side model profile. No cleartext API keys.
CREATE TABLE llm_profile (
 id INT PRIMARY KEY,version INT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT FALSE,
 endpoint VARCHAR(1024) NOT NULL,model_id VARCHAR(160) NOT NULL,key_cipher TEXT NULL,
 updated_by BIGINT NOT NULL,updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 FOREIGN KEY(updated_by) REFERENCES users(id),CHECK (id=1),CHECK (version>=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
