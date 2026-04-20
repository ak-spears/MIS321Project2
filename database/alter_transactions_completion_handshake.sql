-- Adds buyer/seller confirmation timestamps so transactions can be marked completed
-- only after both sides confirm handoff.

ALTER TABLE transactions
    ADD COLUMN buyer_confirmed_at DATETIME NULL AFTER claimed_at,
    ADD COLUMN seller_confirmed_at DATETIME NULL AFTER buyer_confirmed_at;

