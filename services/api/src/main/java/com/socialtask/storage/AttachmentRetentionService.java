package com.socialtask.storage;

import com.socialtask.common.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

@Service
public class AttachmentRetentionService {
    private final Db db;
    private final Audit audit;
    private final Path root;
    private final int pmRetentionDays;
    private final boolean schedulerEnabled;

    public AttachmentRetentionService(Db db, Audit audit,
                                      @Value("${app.upload-dir:./var/uploads}") String directory,
                                      @Value("${app.attachments.private-message-retention-days:90}") int pmRetentionDays,
                                      @Value("${app.scheduler.enabled:true}") boolean schedulerEnabled) throws IOException {
        this.db = db;
        this.audit = audit;
        this.root = Paths.get(directory).toAbsolutePath().normalize();
        this.pmRetentionDays = pmRetentionDays;
        this.schedulerEnabled = schedulerEnabled;
        Files.createDirectories(root);
    }

    @Scheduled(cron = "0 45 3 * * *", zone = "Asia/Shanghai")
    @Transactional
    public void scheduledPurge() {
        if (schedulerEnabled) purgeExpired();
    }

    /** Physically removes expired attachment files while keeping DB metadata rows to preserve FK and audit history. */
    @Transactional
    public Map<String, Object> purgeExpired() {
        int fallbackDays = (pmRetentionDays >= 1 && pmRetentionDays <= 3650) ? pmRetentionDays : 90;
        var rows = db.list(
            "SELECT id, purpose, storage_key FROM attachments WHERE purged_at IS NULL AND ("
                + "(retention_until IS NOT NULL AND retention_until <= UTC_TIMESTAMP(3)) OR "
                + "(retention_until IS NULL AND purpose='PRIVATE_MESSAGE' AND created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY))"
                + ") ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED",
            fallbackDays);
        int purged = 0, failed = 0;
        for (var row : rows) {
            long id = Db.id(row);
            String key = Db.str(row.get("storage_key"));
            String purpose = Db.str(row.get("purpose"));
            Path filePath = root.resolve(key).normalize();
            if (!filePath.startsWith(root)) {
                failed++;
                continue;
            }
            try {
                Files.deleteIfExists(filePath);
            } catch (IOException e) {
                failed++;
                continue;
            }
            db.execute("UPDATE attachments SET purged_at=UTC_TIMESTAMP(3), file_size=0 WHERE id=? AND purged_at IS NULL", id);
            audit.record(null, "attachment", id, "RETENTION_PURGE", Map.of("purpose", purpose));
            purged++;
        }
        return Map.of("purged", purged, "failed", failed);
    }
}
