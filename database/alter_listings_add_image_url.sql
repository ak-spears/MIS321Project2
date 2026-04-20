-- Fix: Unknown column 'image_url' in 'field list' (MySQL 1054 / BadFieldError)
-- Run once on the same database your API connection string uses.
-- If you see "Duplicate column name 'image_url'", the column already exists — skip.

ALTER TABLE listings
    ADD COLUMN image_url MEDIUMTEXT NULL;
