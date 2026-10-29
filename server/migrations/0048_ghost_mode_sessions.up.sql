-- Ghost Mode is a server-authoritative two-hour session. The legacy boolean
-- remains the fast policy flag; the timestamps make expiry and the daily
-- activation quota durable across devices and reinstalls.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ghost_mode_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ghost_mode_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ghost_mode_last_activated_at TIMESTAMPTZ;

-- Existing users may have the legacy boolean enabled. Give that state one
-- bounded session at migration time instead of allowing it to remain
-- indefinite or bypass the new daily quota.
UPDATE users
SET ghost_mode_started_at = NOW(),
    ghost_mode_expires_at = NOW() + INTERVAL '2 hours',
    ghost_mode_last_activated_at = NOW()
WHERE ghost_mode = TRUE
  AND ghost_mode_started_at IS NULL
  AND ghost_mode_expires_at IS NULL
  AND ghost_mode_last_activated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_ghost_mode_expires
    ON users(ghost_mode_expires_at)
    WHERE ghost_mode = TRUE;

COMMENT ON COLUMN users.ghost_mode_started_at IS 'Server time at the current Ghost Mode activation';
COMMENT ON COLUMN users.ghost_mode_expires_at IS 'Server time at which the current Ghost Mode session ends';
COMMENT ON COLUMN users.ghost_mode_last_activated_at IS 'Server time used to enforce one activation per UTC day';
