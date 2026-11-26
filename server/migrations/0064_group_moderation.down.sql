DROP TABLE IF EXISTS group_bans;
ALTER TABLE chat_participants DROP COLUMN IF EXISTS restricted_until;
