DROP TABLE IF EXISTS contact_cooldowns;
DROP TABLE IF EXISTS chat_report_evidence;
ALTER TABLE chat_reports
    DROP COLUMN IF EXISTS evidence_consent_at,
    DROP COLUMN IF EXISTS reported_id;
