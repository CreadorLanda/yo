-- Media access is explicit. Ownership alone is not enough for a recipient,
-- while a bare UUID must never be enough either.
CREATE TABLE IF NOT EXISTS media_grants (
    media_id   UUID NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (media_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_media_grants_user
    ON media_grants (user_id, media_id);

COMMENT ON TABLE media_grants IS
    'Explicit recipient access to media attached to an E2EE chat message';
