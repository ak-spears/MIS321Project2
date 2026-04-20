-- Marks when seller-side platform fee has been settled for a completed transaction.
-- Unpaid + overdue fees can be used to gate new listing creation.

ALTER TABLE transactions
    ADD COLUMN fee_paid_at DATETIME NULL AFTER seller_confirmed_at;

