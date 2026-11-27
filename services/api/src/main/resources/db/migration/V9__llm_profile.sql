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
