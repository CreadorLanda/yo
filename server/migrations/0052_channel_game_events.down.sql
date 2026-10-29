ALTER TABLE channel_posts DROP CONSTRAINT IF EXISTS channel_posts_game_payload_check;
ALTER TABLE channel_posts DROP COLUMN IF EXISTS game_payload;
