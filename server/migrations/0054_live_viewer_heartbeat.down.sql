DROP INDEX IF EXISTS idx_live_viewers_stale;
ALTER TABLE live_viewers DROP COLUMN IF EXISTS last_seen_at;
