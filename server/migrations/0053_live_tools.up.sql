-- Live tools: an audience the host chooses, joint lives, moderation, guests on
-- stage, stored comments and the numbers a host looks at afterwards.

-- A live started from Stories has no home. Its audience is whoever the host
-- picked, so "exactly one of channel or chat" becomes "at most one".
ALTER TABLE lives DROP CONSTRAINT IF EXISTS lives_one_home;
ALTER TABLE lives ADD CONSTRAINT lives_at_most_one_home
    CHECK (channel_id IS NULL OR chat_id IS NULL);

ALTER TABLE lives
    -- Who may watch. 'place' is the members of the chat, group or channel it
    -- was started in; the others are chosen on the way in.
    ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'place'
        CHECK (audience IN ('place', 'contacts', 'selected', 'public')),
    -- Started in a direct chat: both people host it.
    ADD COLUMN IF NOT EXISTS joint BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS comments_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS hearts BIGINT NOT NULL DEFAULT 0;

-- A place audience needs a place.
ALTER TABLE lives ADD CONSTRAINT lives_place_needs_home
    CHECK (audience <> 'place' OR channel_id IS NOT NULL OR chat_id IS NOT NULL);

-- One live from Stories per host at a time, the same rule a chat or channel
-- already has.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lives_running_story
    ON lives (host_id)
    WHERE ended_at IS NULL AND channel_id IS NULL AND chat_id IS NULL;

-- Everyone with a part in a live beyond watching it.
--
-- Flags rather than one role, because they combine: a moderator can be called
-- on stage, and a co-host who declined the invitation is still a co-host who
-- may walk in later.
CREATE TABLE IF NOT EXISTS live_members (
    live_id    UUID NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cohost     BOOLEAN NOT NULL DEFAULT FALSE,
    -- pending until the co-host answers; declining keeps the seat.
    cohost_answer TEXT CHECK (cohost_answer IN ('pending', 'accepted', 'declined')),
    moderator  BOOLEAN NOT NULL DEFAULT FALSE,
    -- On the guest list of a 'selected' live, or invited to watch.
    allowed    BOOLEAN NOT NULL DEFAULT FALSE,
    -- Speaking: invited by a host, requested by the viewer, or on stage.
    stage      TEXT CHECK (stage IN ('invited', 'requested', 'on')),
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (live_id, user_id)
);

CREATE TABLE IF NOT EXISTS live_bans (
    live_id    UUID NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (live_id, user_id)
);

-- Stored, not only relayed: a comment that only travelled the SFU's data
-- channel could not be deleted by a moderator, refused from someone banned, or
-- shown to whoever joins a minute later.
CREATE TABLE IF NOT EXISTS live_comments (
    id         BIGSERIAL PRIMARY KEY,
    live_id    UUID NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_live_comments_live ON live_comments (live_id, id DESC);
