-- Track donation pickup/hand-off in the database.
ALTER TABLE listings
    ADD COLUMN donation_handed_off_at DATETIME NULL AFTER status;

