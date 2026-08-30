-- 0041_story_multi_reactions.down.sql
-- Back to one reaction per person, keeping the newest one.
--
-- This drops data: anyone who left several emoji keeps one. There is no
-- lossless way back, because the narrow key cannot hold the rows.

DELETE FROM story_reactions x
      USING story_reactions y
      WHERE x.story_id = y.story_id
        AND x.user_id = y.user_id
        AND (y.created_at, y.emoji) > (x.created_at, x.emoji);

ALTER TABLE story_reactions DROP CONSTRAINT story_reactions_pkey;
ALTER TABLE story_reactions ADD PRIMARY KEY (story_id, user_id);

COMMENT ON TABLE story_reactions IS NULL;
