-- 0045_add_onboarding_preferences.down.sql
-- Revert onboarding preferences
ALTER TABLE users DROP COLUMN IF EXISTS notifications;
ALTER TABLE users DROP COLUMN IF EXISTS contacts_visible;