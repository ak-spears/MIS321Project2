-- Adds “or best offer” flag for listings (run once per database).
ALTER TABLE listings
    ADD COLUMN or_best_offer TINYINT(1) NOT NULL DEFAULT 0
        COMMENT '1 = seller accepts offers below list price'
    AFTER space_suitability;
