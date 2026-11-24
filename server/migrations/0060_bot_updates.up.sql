-- What a bot receives in privacy mode (#322, ADR 0002).
--
-- A person's client sends the group its normal message, and — when the
-- message is a command, a mention of a bot or a reply to one — a second,
-- pairwise `soc1.` envelope encrypted to that bot alone. This is where those
-- wait until the bot collects them (GET /api/bot/v1/updates, or pushed by the
-- gateway in #323). The server stores ciphertext it cannot open, as anywhere.
CREATE TABLE IF NOT EXISTS bot_updates (
    id               BIGSERIAL PRIMARY KEY,
    bot_id           UUID NOT NULL REFERENCES bots(user_id) ON DELETE CASCADE,
    chat_id          UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL CHECK (kind IN ('command', 'mention', 'reply', 'interaction')),
    content          TEXT NOT NULL,
    -- The group message this is about, when there is one.
    message_id       BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_updates_bot ON bot_updates (bot_id, id);
