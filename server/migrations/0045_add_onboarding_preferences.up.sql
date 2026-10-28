-- 0045_add_onboarding_preferences.sql
-- Onboarding notification and contact visibility preferences
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contacts_visible BOOLEAN NOT NULL DEFAULT TRUE;