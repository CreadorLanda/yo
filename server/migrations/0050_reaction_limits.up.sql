-- 0045_reaction_limits.up.sql
-- Reaction rows are one per user and emoji. The application enforces the
-- maximum of two under a per-item transaction lock.

ALTER TABLE channel_post_reactions
    DROP CONSTRAINT IF EXISTS channel_post_reactions_pkey;
ALTER TABLE channel_post_reactions
    ADD PRIMARY KEY (post_id, user_id, emoji);

CREATE TABLE IF NOT EXISTS channel_comment_reactions (
    comment_id  UUID NOT NULL REFERENCES channel_comments(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (comment_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_channel_comment_reactions_comment
    ON channel_comment_reactions (comment_id, emoji);

CREATE TABLE IF NOT EXISTS story_comment_reactions (
    comment_id  BIGINT NOT NULL REFERENCES story_comments(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (comment_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_story_comment_reactions_comment
    ON story_comment_reactions (comment_id, emoji);
