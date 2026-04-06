-- Fix profile photo (base64 data URL) not persisting: MySQL TEXT caps at 65,535 bytes;
-- JPEG data URLs from the UI are often larger. Run once against your marketplace DB.
ALTER TABLE users MODIFY COLUMN avatar_url MEDIUMTEXT NULL;
