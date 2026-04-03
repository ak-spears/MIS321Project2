-- Run once if avatar_url is too small for base64 JPEG data URLs (need >64KB string).
-- TEXT max is 65,535 bytes; profile uploads often exceed that.
ALTER TABLE users MODIFY COLUMN avatar_url MEDIUMTEXT NULL;
