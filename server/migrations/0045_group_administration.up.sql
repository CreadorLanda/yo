-- Complete group administration: role hierarchy, send permissions,
-- deterministic handoff and evidence-backed achievements.

ALTER TABLE chat_participants
    DROP CONSTRAINT IF EXISTS chat_participants_role_check;

ALTER TABLE chat_participants
    ADD CONSTRAINT chat_participants_role_check
    CHECK (role IN ('admin', 'moderator', 'member'));

ALTER TABLE chats
    ADD COLUMN IF NOT EXISTS text_permission TEXT NOT NULL DEFAULT 'member'
        CHECK (text_permission IN ('member', 'moderator', 'admin')),
    ADD COLUMN IF NOT EXISTS stickers_permission TEXT NOT NULL DEFAULT 'member'
        CHECK (stickers_permission IN ('member', 'moderator', 'admin')),
    ADD COLUMN IF NOT EXISTS audio_permission TEXT NOT NULL DEFAULT 'member'
        CHECK (audio_permission IN ('member', 'moderator', 'admin')),
    ADD COLUMN IF NOT EXISTS media_permission TEXT NOT NULL DEFAULT 'member'
        CHECK (media_permission IN ('member', 'moderator', 'admin')),
    ADD COLUMN IF NOT EXISTS posting_permission TEXT NOT NULL DEFAULT 'member'
        CHECK (posting_permission IN ('member', 'moderator', 'admin')),
    ADD COLUMN IF NOT EXISTS posting_permission_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS group_achievements (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    icon       TEXT NOT NULL,
    name       TEXT NOT NULL,
    criteria   JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT group_achievements_group_check CHECK (jsonb_typeof(criteria) = 'object' AND criteria <> '{}'::jsonb)
);

CREATE INDEX IF NOT EXISTS idx_group_achievements_chat
    ON group_achievements(chat_id, created_at ASC);

CREATE TABLE IF NOT EXISTS group_achievement_awards (
    achievement_id      UUID NOT NULL REFERENCES group_achievements(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    awarded_by          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    evidence_message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
    awarded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (achievement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_achievement_awards_user
    ON group_achievement_awards(user_id, awarded_at DESC);
