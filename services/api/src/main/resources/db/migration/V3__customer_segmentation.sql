-- v1.1 customer segmentation is separate from performer/person tags.
-- Existing customer identity, contact permission and provenance fields are not changed.
CREATE TABLE customer_segments (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 name VARCHAR(100) NOT NULL UNIQUE,
 description VARCHAR(300) NOT NULL DEFAULT '',
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO customer_segments(name,description) VALUES ('未分组','默认客户分组'),('重点意向','管理员人工确认'),('常规咨询','一般咨询客户'),('待人工核验','身份或线索待核实');
ALTER TABLE customers ADD COLUMN segment_id BIGINT NULL;
ALTER TABLE customers ADD CONSTRAINT fk_customer_segment FOREIGN KEY(segment_id) REFERENCES customer_segments(id);
UPDATE customers SET segment_id=(SELECT id FROM customer_segments WHERE name='未分组') WHERE segment_id IS NULL;
CREATE INDEX idx_customer_segment ON customers(segment_id,status);
CREATE TABLE customer_tags (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 name VARCHAR(60) NOT NULL UNIQUE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE customer_tag_links (
 customer_id BIGINT NOT NULL,
 tag_id BIGINT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(customer_id,tag_id),
 FOREIGN KEY(customer_id) REFERENCES customers(id),
 FOREIGN KEY(tag_id) REFERENCES customer_tags(id),
 INDEX idx_customer_tag(tag_id,customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
