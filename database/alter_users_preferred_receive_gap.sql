-- How the user prefers to receive items when buying (same codes as listing gap_solution).
ALTER TABLE users
    ADD COLUMN preferred_receive_gap VARCHAR(32) NULL
        COMMENT 'storage | pickup_window | ship_or_deliver — buyer preference';
