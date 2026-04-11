-- Item condition + dimensions (UI collects these; were missing from schema)
ALTER TABLE listings
    ADD COLUMN item_condition VARCHAR(32) NULL COMMENT 'new | like_new | good | fair' AFTER category,
    ADD COLUMN dimensions VARCHAR(120) NULL COMMENT 'optional size text' AFTER item_condition;
