-- Message bodies are end-to-end encrypted, so attachment URLs cannot be
-- discovered by the server. Keep only the attachment-to-message relation;
-- access is evaluated against current chat membership and message visibility.
CREATE TABLE IF NOT EXISTS chat_media_access (
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    media_id   UUID NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, media_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_media_access_media
    ON chat_media_access (media_id, message_id);
