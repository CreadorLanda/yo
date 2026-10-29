ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS pending_email TEXT,
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci_unique
    ON users (LOWER(email))
    WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_verifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    code_hash   BYTEA NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS email_verifications_user_idx
    ON email_verifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS phone_change_challenges (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    destination_phone_hash BYTEA NOT NULL,
    destination_code_hash BYTEA NOT NULL,
    expires_at             TIMESTAMPTZ NOT NULL,
    attempts               INTEGER NOT NULL DEFAULT 0,
    consumed_at            TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS phone_change_challenges_user_idx
    ON phone_change_challenges(user_id, created_at DESC);
