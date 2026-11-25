-- Event delivery to bots: webhooks and the websocket gateway (#323).
--
-- Every event for a bot is written once to bot_events. Its id is the
-- sequence number a gateway connection resumes from, and a webhook delivery
-- points at it. Payloads carry what the server already holds: ciphertext,
-- ids and timestamps, never plaintext (ADR 0002).

ALTER TABLE bots
    ADD COLUMN IF NOT EXISTS webhook_url    TEXT,
    -- HMAC key for signing deliveries. Kept, not hashed: the server signs
    -- with it. Shown to the owner once, when made or rotated.
    ADD COLUMN IF NOT EXISTS webhook_secret TEXT,
    -- Event types the webhook wants; empty means every type.
    ADD COLUMN IF NOT EXISTS intents        TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS bot_events (
    id         BIGSERIAL PRIMARY KEY,
    bot_id     UUID NOT NULL REFERENCES bots(user_id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    chat_id    UUID,
    payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_events_bot ON bot_events (bot_id, id);
CREATE INDEX IF NOT EXISTS idx_bot_events_created ON bot_events (created_at);

CREATE TABLE IF NOT EXISTS bot_deliveries (
    id              BIGSERIAL PRIMARY KEY,
    event_id        BIGINT NOT NULL REFERENCES bot_events(id) ON DELETE CASCADE,
    bot_id          UUID NOT NULL REFERENCES bots(user_id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'delivered', 'dead')),
    attempts        INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_status     INT,
    last_error      TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at    TIMESTAMPTZ
);

-- The worker's queue, and the owner's delivery log.
CREATE INDEX IF NOT EXISTS idx_bot_deliveries_due
    ON bot_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bot_deliveries_bot ON bot_deliveries (bot_id, id DESC);
