-- 0041_story_multi_reactions.up.sql
-- One person may leave several emoji on the same story.
--
-- The old primary key was (story_id, user_id), so a second reaction from the
-- same person replaced the first — reacting 🔥 then ❤️ left only ❤️. Adding
-- emoji to the key turns the row into "this person left this emoji", which is
-- what it always meant.

ALTER TABLE story_reactions DROP CONSTRAINT story_reactions_pkey;
ALTER TABLE story_reactions ADD PRIMARY KEY (story_id, user_id, emoji);

-- Counting reactions per story reads (story_id) alone; the primary key above
-- leads with it, so no separate index is needed.

COMMENT ON TABLE story_reactions IS
    'Emoji left on a story. One row per (story, person, emoji).';
