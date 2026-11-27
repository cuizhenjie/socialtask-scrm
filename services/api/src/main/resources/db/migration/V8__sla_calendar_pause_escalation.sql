ALTER TABLE sla_policies
 ADD COLUMN closed_dates TEXT NULL,
 ADD COLUMN open_dates TEXT NULL,
 ADD COLUMN escalation_minutes VARCHAR(80) NOT NULL DEFAULT '';

ALTER TABLE task_sla
 ADD COLUMN calendar_snapshot JSONB NULL,
 ADD COLUMN response_warning_minutes INT NOT NULL DEFAULT 30,
 ADD COLUMN resolution_warning_minutes INT NOT NULL DEFAULT 60,
 ADD COLUMN escalation_minutes VARCHAR(80) NOT NULL DEFAULT '',
 ADD COLUMN paused_at TIMESTAMPTZ(3) NULL,
 ADD COLUMN pause_reason VARCHAR(300) NULL,
 ADD COLUMN response_remaining_ms BIGINT NULL,
 ADD COLUMN resolution_remaining_ms BIGINT NULL,
 ADD COLUMN pause_count INT NOT NULL DEFAULT 0,
 ADD COLUMN paused_total_ms BIGINT NOT NULL DEFAULT 0,
 ADD COLUMN response_escalation_level INT NOT NULL DEFAULT 0,
 ADD COLUMN resolution_escalation_level INT NOT NULL DEFAULT 0,
 ADD COLUMN next_response_escalation_at TIMESTAMPTZ(3) NULL,
 ADD COLUMN next_resolution_escalation_at TIMESTAMPTZ(3) NULL;

-- Existing due dates and historical breach flags are not changed. Historical calendar revisions before V8 cannot be reconstructed.
UPDATE task_sla s
SET calendar_snapshot = jsonb_build_object(
      'calendar_mode', p.calendar_mode,
      'timezone', p.timezone,
      'business_start', p.business_start,
      'business_end', p.business_end,
      'working_days', p.working_days,
      'closed_dates', COALESCE(p.closed_dates, ''),
      'open_dates', COALESCE(p.open_dates, '')
    ),
    response_warning_minutes = p.response_warning_minutes,
    resolution_warning_minutes = p.resolution_warning_minutes,
    escalation_minutes = p.escalation_minutes
FROM sla_policies p
WHERE p.id = s.policy_id;

CREATE INDEX idx_sla_escalate_response ON task_sla(next_response_escalation_at);
CREATE INDEX idx_sla_escalate_resolution ON task_sla(next_resolution_escalation_at);
