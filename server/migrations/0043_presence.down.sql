ALTER TABLE users
    DROP COLUMN IF EXISTS last_seen_at,
    DROP COLUMN IF EXISTS last_seen_frozen,
    DROP COLUMN IF EXISTS is_premium;
