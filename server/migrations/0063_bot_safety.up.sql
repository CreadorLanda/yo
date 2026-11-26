-- Keeping bots from becoming the easiest way to spam or leak data (#343).

-- A suspended bot cannot authenticate. `rate_limit` is automatic and the
-- owner can lift it; anything else is the operators' and only they can.
ALTER TABLE bots
    ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS suspended_reason TEXT NOT NULL DEFAULT '';

-- What happened with bots in a group, for its admins. Metadata only: who
-- did what to which bot, never what anyone wrote.
CREATE TABLE IF NOT EXISTS bot_audit (
    id         BIGSERIAL PRIMARY KEY,
    chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    bot_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_audit_chat ON bot_audit (chat_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_bot_audit_created ON bot_audit (created_at);
