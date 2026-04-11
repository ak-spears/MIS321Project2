-- Space fit for dorm listings (run once on existing DBs).
ALTER TABLE listings
    ADD COLUMN space_suitability VARCHAR(32) NULL COMMENT 'small_dorm | any_space' AFTER delivery_notes;
