-- Trust & safety: when 1, seller cannot create/update listings (API enforces).
-- Run once against your marketplace DB.

ALTER TABLE users
    ADD COLUMN on_probation TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = admin probation — block new/edited listings'
    AFTER rating_count;
