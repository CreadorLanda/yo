-- Bots: accounts, tokens and per-chat installations (#321, ADR 0002).
--
-- A bot is a row in `users` with kind = 'bot', so everything that already
-- works for a participant (chat membership, devices, keys, messages, media)
-- works for a bot without a parallel set of tables. What is specific to bots
-- lives here: who owns it, how it authenticates, and what each chat allowed.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'person';

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_kind_check;
ALTER TABLE users
    ADD CONSTRAINT users_kind_check CHECK (kind IN ('person', 'bot'));

-- Bots have no phone. A person still must have one.
ALTER TABLE users ALTER COLUMN phone_hash DROP NOT NULL;
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_phone_required_check;
ALTER TABLE users
    ADD CONSTRAINT users_phone_required_check
    CHECK (kind = 'bot' OR phone_hash IS NOT NULL);

-- A bot publishes identity and pre-keys from a device of its own.
ALTER TABLE devices
    DROP CONSTRAINT IF EXISTS devices_platform_check;
ALTER TABLE devices
    ADD CONSTRAINT devices_platform_check
    CHECK (platform IN ('ios', 'android', 'web', 'desktop', 'bot'));

CREATE TABLE IF NOT EXISTS bots (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id    UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    description  TEXT NOT NULL DEFAULT '',
    -- ADR 0002: true means the bot only receives what is addressed to it.
    privacy_mode BOOLEAN NOT NULL DEFAULT TRUE,
    verified     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bots_owner ON bots (owner_id);

-- Removing a bot row (or its owner, through the cascade above) removes the
-- bot's account too, and with it every membership and key it held.
CREATE OR REPLACE FUNCTION delete_bot_user() RETURNS trigger AS $$
BEGIN
    DELETE FROM users WHERE id = OLD.user_id AND kind = 'bot';
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delete_bot_user ON bots;
CREATE TRIGGER trg_delete_bot_user
    AFTER DELETE ON bots
    FOR EACH ROW EXECUTE FUNCTION delete_bot_user();

-- Only a hash is stored. The secret is shown to the owner once.
CREATE TABLE IF NOT EXISTS bot_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id       UUID NOT NULL REFERENCES bots(user_id) ON DELETE CASCADE,
    token_hash   BYTEA NOT NULL UNIQUE,
    -- First characters of the secret, so an owner can tell tokens apart.
    prefix       TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bot_tokens_bot ON bot_tokens (bot_id);

CREATE TABLE IF NOT EXISTS bot_installations (
    chat_id      UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    bot_id       UUID NOT NULL REFERENCES bots(user_id) ON DELETE CASCADE,
    installed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    scopes       TEXT[] NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, bot_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_installations_bot ON bot_installations (bot_id);
