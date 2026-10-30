-- Revert contact discovery preference
ALTER TABLE users DROP COLUMN IF EXISTS contacts_visible;
