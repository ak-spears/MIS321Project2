-- Optional seller/buyer fulfillment prefs on users (profile + signup).
-- Run if you see Unknown column 'default_gap_solution' or 'preferred_receive_gap'.
-- If a column already exists, skip that statement (MySQL will error on duplicate ADD).

ALTER TABLE users
    ADD COLUMN default_gap_solution VARCHAR(32) NULL
        COMMENT 'storage | pickup_window | ship_or_deliver' AFTER avatar_url;

ALTER TABLE users
    ADD COLUMN preferred_receive_gap VARCHAR(32) NULL
        COMMENT 'storage | pickup_window | ship_or_deliver — buyer preference';
