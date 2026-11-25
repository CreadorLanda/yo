DROP TABLE IF EXISTS bot_audit;
ALTER TABLE bots
    DROP COLUMN IF EXISTS suspended_reason,
    DROP COLUMN IF EXISTS suspended_at;
