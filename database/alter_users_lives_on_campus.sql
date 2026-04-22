-- Add users.lives_on_campus (signup + profile) if your DB was created before this column existed.
-- Prefer running database/catchup_api_schema_idempotent.sql (idempotent, adds phone/move_* and more).
-- If this line errors with "Duplicate column", you already have it.
ALTER TABLE users ADD COLUMN lives_on_campus TINYINT(1) NOT NULL DEFAULT 0;
