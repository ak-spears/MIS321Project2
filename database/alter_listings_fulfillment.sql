-- Seller fulfillment (matches frontend gap / pickup / delivery fields).
-- gap_solution = delivery/transfer method: storage | pickup_window | ship_or_deliver
-- Run once on existing databases (safe to skip columns that already exist — run statements one-by-one if needed).
ALTER TABLE listings
    ADD COLUMN gap_solution VARCHAR(32) NULL,
    ADD COLUMN storage_notes TEXT NULL,
    ADD COLUMN pickup_start DATE NULL,
    ADD COLUMN pickup_end DATE NULL,
    ADD COLUMN pickup_location VARCHAR(255) NULL,
    ADD COLUMN delivery_notes TEXT NULL;
