-- Typical fulfillment preference when selling (used as default when AI fills listing form).
ALTER TABLE users
    ADD COLUMN default_gap_solution VARCHAR(32) NULL
        COMMENT 'storage | pickup_window | ship_or_deliver' AFTER avatar_url;
