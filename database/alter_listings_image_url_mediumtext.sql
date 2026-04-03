-- Listing photos are often data URLs; VARCHAR(500) truncates. Run once on existing DBs.
ALTER TABLE listings MODIFY COLUMN image_url MEDIUMTEXT NULL;
