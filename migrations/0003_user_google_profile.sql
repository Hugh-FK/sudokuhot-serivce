ALTER TABLE users ADD COLUMN google_id TEXT;
ALTER TABLE users ADD COLUMN locale TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique ON users(google_id) WHERE google_id IS NOT NULL;
