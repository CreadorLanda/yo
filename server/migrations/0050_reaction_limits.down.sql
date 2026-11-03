-- 0045_reaction_limits.down.sql

DROP TABLE IF EXISTS story_comment_reactions;
DROP TABLE IF EXISTS channel_comment_reactions;

DELETE FROM channel_post_reactions a
USING channel_post_reactions b
WHERE a.post_id = b.post_id
  AND a.user_id = b.user_id
  AND a.created_at < b.created_at;

ALTER TABLE channel_post_reactions
    DROP CONSTRAINT IF EXISTS channel_post_reactions_pkey;
ALTER TABLE channel_post_reactions
    ADD PRIMARY KEY (post_id, user_id);
