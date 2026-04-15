-- Add moderation flags for reviews/ratings.
ALTER TABLE ratings
    ADD COLUMN is_flagged TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN is_harsh TINYINT(1) NOT NULL DEFAULT 0;

