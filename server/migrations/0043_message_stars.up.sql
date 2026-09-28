-- 0043_message_stars.up.sql
-- Personal message favorites; a star belongs to one participant, not the chat.

CREATE TABLE IF NOT EXISTS message_stars (
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_stars_user_message
    ON message_stars (user_id, message_id);

COMMENT ON TABLE message_stars IS 'Per-user starred messages';
