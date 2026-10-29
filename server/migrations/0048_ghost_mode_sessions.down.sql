-- Rolling back removes the session columns. Disable active sessions first so
-- the legacy boolean cannot survive as an unbounded Ghost Mode session.
UPDATE users SET ghost_mode = FALSE
WHERE ghost_mode = TRUE;

DROP INDEX IF EXISTS idx_users_ghost_mode_expires;

ALTER TABLE users
    DROP COLUMN IF EXISTS ghost_mode_last_activated_at,
    DROP COLUMN IF EXISTS ghost_mode_expires_at,
    DROP COLUMN IF EXISTS ghost_mode_started_at;
