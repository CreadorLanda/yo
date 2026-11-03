DROP TABLE IF EXISTS phone_change_challenges;
DROP TABLE IF EXISTS email_verifications;
DROP INDEX IF EXISTS users_email_ci_unique;
ALTER TABLE users
    DROP COLUMN IF EXISTS email_verified_at,
    DROP COLUMN IF EXISTS pending_email,
    DROP COLUMN IF EXISTS email;
