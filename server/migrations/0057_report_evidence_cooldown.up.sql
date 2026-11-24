-- Reports with evidence, and the no-contact period that follows one.
--
-- Bodies are end-to-end encrypted, so the server cannot read a conversation
-- to build evidence. What it can hold is a copy the reporter chooses to send
-- after being told exactly what leaves their phone. That copy is unverified by
-- construction (the server cannot check it against ciphertext), so it lives in
-- its own table, is never returned by any user-facing endpoint, and expires.

ALTER TABLE chat_reports
    -- The other person of a one-to-one chat. Null for groups, where there is
    -- no single person to keep apart.
    ADD COLUMN IF NOT EXISTS reported_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- When the reporter agreed to send message copies. Null when none were sent.
    ADD COLUMN IF NOT EXISTS evidence_consent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS chat_report_evidence (
    id         BIGSERIAL PRIMARY KEY,
    report_id  BIGINT NOT NULL REFERENCES chat_reports(id) ON DELETE CASCADE,
    -- Which message the copy claims to be. Checked to belong to the reported
    -- chat; its sender is read from the database, never from the client.
    message_id BIGINT NOT NULL,
    sender_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    sent_at    TIMESTAMPTZ NOT NULL,
    -- Moderation needs it for as long as a report can be reviewed, not forever.
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 days',
    UNIQUE (report_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_report_evidence_expiry
    ON chat_report_evidence (expires_at);

-- Two people who may not contact each other until a deadline.
--
-- A pair, stored once with the smaller id first, so "in both directions" is a
-- property of the row rather than something every query has to remember. It is
-- separate from blocks on purpose: unblocking removes a block and must not lift
-- this.
CREATE TABLE IF NOT EXISTS contact_cooldowns (
    user_low   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    until      TIMESTAMPTZ NOT NULL,
    report_id  BIGINT REFERENCES chat_reports(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_low, user_high),
    CHECK (user_low < user_high)
);

CREATE INDEX IF NOT EXISTS idx_contact_cooldowns_until ON contact_cooldowns (until);
