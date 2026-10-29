DROP TABLE IF EXISTS group_achievement_awards;
DROP TABLE IF EXISTS group_achievements;

ALTER TABLE chats
    DROP COLUMN IF EXISTS posting_permission_until,
    DROP COLUMN IF EXISTS posting_permission,
    DROP COLUMN IF EXISTS media_permission,
    DROP COLUMN IF EXISTS audio_permission,
    DROP COLUMN IF EXISTS stickers_permission,
    DROP COLUMN IF EXISTS text_permission;

ALTER TABLE chat_participants
    DROP CONSTRAINT IF EXISTS chat_participants_role_check;

ALTER TABLE chat_participants
    ADD CONSTRAINT chat_participants_role_check
    CHECK (role IN ('admin', 'member'));
