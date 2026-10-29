-- Saved-messages conversations are direct chats with one participant: their
-- owner. They are active immediately and must be unique per account.
ALTER TABLE chats
    ADD COLUMN IF NOT EXISTS is_self BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chats_self_type_check'
          AND conrelid = 'chats'::regclass
    ) THEN
        ALTER TABLE chats
            ADD CONSTRAINT chats_self_type_check
            CHECK (NOT is_self OR type = 'direct');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chats_created_by
    ON chats (created_by);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chats_self_owner
    ON chats (created_by)
    WHERE is_self;

COMMENT ON COLUMN chats.is_self IS
    'Saved-messages chat owned by created_by; active and unique per account';
