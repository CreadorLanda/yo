-- Slash commands bots register (#324). A command is global (chat_id NULL),
-- or set for one chat, where it replaces a global one of the same name.
-- Names, descriptions and option schemas are public metadata, like a bot's
-- profile; what people type into a command still travels encrypted.
CREATE TABLE IF NOT EXISTS bot_commands (
    bot_id         UUID NOT NULL REFERENCES bots(user_id) ON DELETE CASCADE,
    chat_id        UUID REFERENCES chats(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL,
    description_pt TEXT NOT NULL DEFAULT '',
    options        JSONB NOT NULL DEFAULT '[]'::jsonb,
    position       INT NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_commands_unique
    ON bot_commands (bot_id, COALESCE(chat_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
CREATE INDEX IF NOT EXISTS idx_bot_commands_chat ON bot_commands (chat_id) WHERE chat_id IS NOT NULL;
