-- Moderation (#333): a member can be kept from sending until a time, and a
-- banned person cannot be added back. Both are set by group admins or by a
-- bot the admins allowed to moderate (members.manage).
ALTER TABLE chat_participants ADD COLUMN IF NOT EXISTS restricted_until TIMESTAMPTZ;

COMMENT ON COLUMN chat_participants.restricted_until IS 'Muted by a moderator: no sending until this instant';

CREATE TABLE IF NOT EXISTS group_bans (
    chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    reason     TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);
