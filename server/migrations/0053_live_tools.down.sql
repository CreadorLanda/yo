DROP TABLE IF EXISTS live_comments;
DROP TABLE IF EXISTS live_bans;
DROP TABLE IF EXISTS live_members;
DROP INDEX IF EXISTS idx_lives_running_story;
ALTER TABLE lives DROP CONSTRAINT IF EXISTS lives_place_needs_home;
-- Lives from Stories have no home and cannot satisfy the old rule.
DELETE FROM lives WHERE channel_id IS NULL AND chat_id IS NULL;
ALTER TABLE lives
    DROP COLUMN IF EXISTS hearts,
    DROP COLUMN IF EXISTS comments_enabled,
    DROP COLUMN IF EXISTS joint,
    DROP COLUMN IF EXISTS audience;
ALTER TABLE lives DROP CONSTRAINT IF EXISTS lives_at_most_one_home;
ALTER TABLE lives ADD CONSTRAINT lives_one_home CHECK (
    (channel_id IS NOT NULL AND chat_id IS NULL) OR
    (channel_id IS NULL AND chat_id IS NOT NULL)
);
