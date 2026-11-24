DROP TABLE IF EXISTS bot_installations;
DROP TABLE IF EXISTS bot_tokens;
DROP TRIGGER IF EXISTS trg_delete_bot_user ON bots;
DROP TABLE IF EXISTS bots;
DROP FUNCTION IF EXISTS delete_bot_user();

DELETE FROM users WHERE kind = 'bot';

ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_platform_check;
ALTER TABLE devices
    ADD CONSTRAINT devices_platform_check
    CHECK (platform IN ('ios', 'android', 'web', 'desktop'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_required_check;
ALTER TABLE users ALTER COLUMN phone_hash SET NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_kind_check;
ALTER TABLE users DROP COLUMN IF EXISTS kind;
