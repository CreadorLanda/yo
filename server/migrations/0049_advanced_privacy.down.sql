DROP INDEX IF EXISTS idx_messages_source_chat;

ALTER TABLE messages
    DROP COLUMN IF EXISTS source_message_id,
    DROP COLUMN IF EXISTS source_chat_id;

ALTER TABLE chats
    DROP COLUMN IF EXISTS forwarding_disabled,
    DROP COLUMN IF EXISTS screenshot_protection_enabled,
    DROP COLUMN IF EXISTS links_require_confirmation,
    DROP COLUMN IF EXISTS who_can_message,
    DROP COLUMN IF EXISTS who_can_call,
    DROP COLUMN IF EXISTS allowed_message_types;
