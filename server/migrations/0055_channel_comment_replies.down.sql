DROP INDEX IF EXISTS idx_channel_comments_parent;
ALTER TABLE channel_comments DROP COLUMN IF EXISTS parent_id;