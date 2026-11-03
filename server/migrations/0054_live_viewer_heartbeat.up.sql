ALTER TABLE live_viewers
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_live_viewers_stale
    ON live_viewers (last_seen_at)
    WHERE left_at IS NULL;
