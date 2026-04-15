-- Minimal fix: Unknown column 'display_name' (run once on your MySQL DB).
-- Duplicate column error = already done.

ALTER TABLE users ADD COLUMN display_name VARCHAR(60) NOT NULL DEFAULT 'User';
