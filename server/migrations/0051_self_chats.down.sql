DROP INDEX IF EXISTS uq_chats_self_owner;
DROP INDEX IF EXISTS idx_chats_created_by;
ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_self_type_check;
ALTER TABLE chats DROP COLUMN IF EXISTS is_self;
