-- Contact discovery preference
ALTER TABLE users ADD COLUMN IF NOT EXISTS contacts_visible BOOLEAN NOT NULL DEFAULT TRUE;
