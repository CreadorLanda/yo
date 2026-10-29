-- Advanced chat privacy policies.
--
-- These controls live on the conversation because they describe what the
-- conversation permits, not a device-local preference. The creator owns the
-- policy for direct chats; group administrators do.
ALTER TABLE chats
    ADD COLUMN IF NOT EXISTS forwarding_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS screenshot_protection_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS links_require_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS who_can_message TEXT NOT NULL DEFAULT 'everyone'
        CHECK (who_can_message IN ('everyone', 'admins')),
    ADD COLUMN IF NOT EXISTS who_can_call TEXT NOT NULL DEFAULT 'everyone'
        CHECK (who_can_call IN ('everyone', 'admins')),
    ADD COLUMN IF NOT EXISTS allowed_message_types TEXT[] NOT NULL DEFAULT ARRAY[
        'text', 'image', 'video', 'audio', 'document', 'sticker',
        'location', 'contact', 'poll', 'event', 'reply', 'game'
    ]::TEXT[];

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS source_chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_message_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_messages_source_chat
    ON messages(source_chat_id) WHERE source_chat_id IS NOT NULL;

COMMENT ON COLUMN chats.forwarding_disabled IS 'Explicit forwarding from this conversation is refused';
COMMENT ON COLUMN chats.screenshot_protection_enabled IS 'Client requests platform screenshot protection when available';
COMMENT ON COLUMN chats.links_require_confirmation IS 'Clients must confirm before opening shared links';
COMMENT ON COLUMN chats.who_can_message IS 'everyone or group administrators';
COMMENT ON COLUMN chats.who_can_call IS 'everyone or group administrators';
COMMENT ON COLUMN chats.allowed_message_types IS 'Message types accepted by the conversation';
COMMENT ON COLUMN messages.source_chat_id IS 'Conversation origin for explicit forwards';
COMMENT ON COLUMN messages.source_message_id IS 'Original message id for explicit forwards';
