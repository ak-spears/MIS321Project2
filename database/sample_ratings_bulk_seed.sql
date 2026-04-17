-- =============================================================================
-- Sample ratings + listings + seed users (for dev / demos)
-- =============================================================================
-- Prerequisites:
--   - At least one campus (usually campus_id = 1 for UA). Run marketplace_schema.sql seed if needed.
--
-- What this does:
--   - Inserts 10 seller accounts + 18 buyer accounts (emails seed_seller_XX@ua.edu, seed_buyer_XX@ua.edu).
--   - Inserts ~20 sold listings (titles prefixed SEED_TX_...) so profiles show inventory.
--   - Inserts ~35 ratings: each row ties (listing_id, rater_id=buyer, ratee_id=seller, score 1–5).
--   - Recomputes users.avg_rating + users.rating_count from the ratings table (optional columns).
--
-- Password for all seed accounts: password
--   (BCrypt hash below matches BCrypt.Net / typical Laravel test hash.)
--
-- Run in MySQL Workbench or: mysql ... < database/sample_ratings_bulk_seed.sql
--
-- To REMOVE this sample data later, run the cleanup block at the bottom.
-- =============================================================================

SET @campus_id := 1;
SET @pwd := '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

-- -----------------------------------------------------------------------------
-- Seed users (skip if email already exists — safe to re-run if you delete first)
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO users (
    campus_id, email, password_hash, display_name, phone,
    lives_on_campus, move_in_date, move_out_date, dorm_building, suite_letter,
    avg_rating, rating_count
) VALUES
-- sellers 01–10
(@campus_id, 'seed_seller_01@ua.edu', @pwd, 'Seed Seller 01', '205-555-1001', 1, '2024-08-15', NULL, 'Ridgecrest', 'A', 0.00, 0),
(@campus_id, 'seed_seller_02@ua.edu', @pwd, 'Seed Seller 02', '205-555-1002', 1, '2024-08-15', NULL, 'Paty', 'B', 0.00, 0),
(@campus_id, 'seed_seller_03@ua.edu', @pwd, 'Seed Seller 03', '205-555-1003', 0, '2024-08-20', NULL, NULL, NULL, 0.00, 0),
(@campus_id, 'seed_seller_04@ua.edu', @pwd, 'Seed Seller 04', '205-555-1004', 1, '2024-08-10', NULL, 'Blount', 'C', 0.00, 0),
(@campus_id, 'seed_seller_05@ua.edu', @pwd, 'Seed Seller 05', '205-555-1005', 1, '2024-08-12', NULL, 'Presidential', 'A', 0.00, 0),
(@campus_id, 'seed_seller_06@ua.edu', @pwd, 'Seed Seller 06', '205-555-1006', 0, '2024-08-18', NULL, NULL, NULL, 0.00, 0),
(@campus_id, 'seed_seller_07@ua.edu', @pwd, 'Seed Seller 07', '205-555-1007', 1, '2024-08-14', NULL, 'Bryant', 'D', 0.00, 0),
(@campus_id, 'seed_seller_08@ua.edu', @pwd, 'Seed Seller 08', '205-555-1008', 1, '2024-08-16', NULL, 'Parham', 'B', 0.00, 0),
(@campus_id, 'seed_seller_09@ua.edu', @pwd, 'Seed Seller 09', '205-555-1009', 0, '2024-08-22', NULL, NULL, NULL, 0.00, 0),
(@campus_id, 'seed_seller_10@ua.edu', @pwd, 'Seed Seller 10', '205-555-1010', 1, '2024-08-11', NULL, 'Heflin', 'A', 0.00, 0),
-- buyers 01–18
(@campus_id, 'seed_buyer_01@ua.edu', @pwd, 'Seed Buyer 01', '205-555-2001', 1, '2024-08-15', NULL, 'Ridgecrest', 'B', 0.00, 0),
(@campus_id, 'seed_buyer_02@ua.edu', @pwd, 'Seed Buyer 02', '205-555-2002', 1, '2024-08-15', NULL, 'Ridgecrest', 'C', 0.00, 0),
(@campus_id, 'seed_buyer_03@ua.edu', @pwd, 'Seed Buyer 03', '205-555-2003', 1, '2024-08-16', NULL, 'Paty', 'A', 0.00, 0),
(@campus_id, 'seed_buyer_04@ua.edu', @pwd, 'Seed Buyer 04', '205-555-2004', 0, '2024-08-17', NULL, NULL, NULL, 0.00, 0),
(@campus_id, 'seed_buyer_05@ua.edu', @pwd, 'Seed Buyer 05', '205-555-2005', 1, '2024-08-14', NULL, 'Blount', 'D', 0.00, 0),
(@campus_id, 'seed_buyer_06@ua.edu', @pwd, 'Seed Buyer 06', '205-555-2006', 1, '2024-08-13', NULL, 'Presidential', 'B', 0.00, 0),
(@campus_id, 'seed_buyer_07@ua.edu', @pwd, 'Seed Buyer 07', '205-555-2007', 1, '2024-08-18', NULL, 'Bryant', 'A', 0.00, 0),
(@campus_id, 'seed_buyer_08@ua.edu', @pwd, 'Seed Buyer 08', '205-555-2008', 0, '2024-08-19', NULL, NULL, NULL, 0.00, 0),
(@campus_id, 'seed_buyer_09@ua.edu', @pwd, 'Seed Buyer 09', '205-555-2009', 1, '2024-08-12', NULL, 'Parham', 'C', 0.00, 0),
(@campus_id, 'seed_buyer_10@ua.edu', @pwd, 'Seed Buyer 10', '205-555-2010', 1, '2024-08-11', NULL, 'Heflin', 'B', 0.00, 0),
(@campus_id, 'seed_buyer_11@ua.edu', @pwd, 'Seed Buyer 11', '205-555-2011', 1, '2024-08-20', NULL, 'Ridgecrest', 'A', 0.00, 0),
(@campus_id, 'seed_buyer_12@ua.edu', @pwd, 'Seed Buyer 12', '205-555-2012', 1, '2024-08-21', NULL, 'Paty', 'D', 0.00, 0),
(@campus_id, 'seed_buyer_13@ua.edu', @pwd, 'Seed Buyer 13', '205-555-2013', 0, '2024-08-22', NULL, NULL, NULL, 0.00, 0),
(@campus_id, 'seed_buyer_14@ua.edu', @pwd, 'Seed Buyer 14', '205-555-2014', 1, '2024-08-09', NULL, 'Blount', 'A', 0.00, 0),
(@campus_id, 'seed_buyer_15@ua.edu', @pwd, 'Seed Buyer 15', '205-555-2015', 1, '2024-08-10', NULL, 'Presidential', 'C', 0.00, 0),
(@campus_id, 'seed_buyer_16@ua.edu', @pwd, 'Seed Buyer 16', '205-555-2016', 1, '2024-08-17', NULL, 'Bryant', 'B', 0.00, 0),
(@campus_id, 'seed_buyer_17@ua.edu', @pwd, 'Seed Buyer 17', '205-555-2017', 0, '2024-08-23', NULL, NULL, NULL, 0.00, 0),
(@campus_id, 'seed_buyer_18@ua.edu', @pwd, 'Seed Buyer 18', '205-555-2018', 1, '2024-08-14', NULL, 'Parham', 'A', 0.00, 0);

-- -----------------------------------------------------------------------------
-- Sold listings (two per seller) — SEED_TX_ titles are unique for cleanup
-- -----------------------------------------------------------------------------
INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S01_A', 'Sample sold item (seed)', 20.00, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_01@ua.edu' LIMIT 1;
INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S01_B', 'Sample sold item (seed)', 15.00, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_01@ua.edu' LIMIT 1;

INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S02_A', 'Sample sold item (seed)', 40.00, 'furniture', 'sold' FROM users u WHERE u.email = 'seed_seller_02@ua.edu' LIMIT 1;
INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S02_B', 'Sample sold item (seed)', 8.50, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_02@ua.edu' LIMIT 1;

INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S03_A', 'Sample sold item (seed)', 120.00, 'electronics', 'sold' FROM users u WHERE u.email = 'seed_seller_03@ua.edu' LIMIT 1;
INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S03_B', 'Sample sold item (seed)', 22.00, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_03@ua.edu' LIMIT 1;

INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S04_A', 'Sample sold item (seed)', 5.00, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_04@ua.edu' LIMIT 1;
INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S04_B', 'Sample sold item (seed)', 60.00, 'appliances', 'sold' FROM users u WHERE u.email = 'seed_seller_04@ua.edu' LIMIT 1;

INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S05_A', 'Sample sold item (seed)', 18.00, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_05@ua.edu' LIMIT 1;
INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S05_B', 'Sample sold item (seed)', 30.00, 'furniture', 'sold' FROM users u WHERE u.email = 'seed_seller_05@ua.edu' LIMIT 1;

INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S06_A', 'Sample sold item (seed)', 11.00, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_06@ua.edu' LIMIT 1;
INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S06_B', 'Sample sold item (seed)', 9.00, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_06@ua.edu' LIMIT 1;

INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S07_A', 'Sample sold item (seed)', 75.00, 'electronics', 'sold' FROM users u WHERE u.email = 'seed_seller_07@ua.edu' LIMIT 1;
INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S07_B', 'Sample sold item (seed)', 14.00, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_07@ua.edu' LIMIT 1;

INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S08_A', 'Sample sold item (seed)', 6.00, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_08@ua.edu' LIMIT 1;
INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S08_B', 'Sample sold item (seed)', 55.00, 'furniture', 'sold' FROM users u WHERE u.email = 'seed_seller_08@ua.edu' LIMIT 1;

INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S09_A', 'Sample sold item (seed)', 99.00, 'electronics', 'sold' FROM users u WHERE u.email = 'seed_seller_09@ua.edu' LIMIT 1;
INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S09_B', 'Sample sold item (seed)', 12.00, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_09@ua.edu' LIMIT 1;

INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S10_A', 'Sample sold item (seed)', 25.00, 'other', 'sold' FROM users u WHERE u.email = 'seed_seller_10@ua.edu' LIMIT 1;
INSERT INTO listings (campus_id, seller_id, title, description, price, category, status)
SELECT @campus_id, u.user_id, 'SEED_TX_S10_B', 'Sample sold item (seed)', 33.00, 'furniture', 'sold' FROM users u WHERE u.email = 'seed_seller_10@ua.edu' LIMIT 1;

-- -----------------------------------------------------------------------------
-- Ratings: (listing_id, rater_id, ratee_id, score) — ratee = seller of that listing
-- Scores spread: highs, mids, lows for testing aggregates / thresholds.
-- -----------------------------------------------------------------------------
INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 5, 'Perfect — would buy again.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_01@ua.edu'
JOIN users b ON b.email = 'seed_buyer_01@ua.edu' WHERE l.title = 'SEED_TX_S01_A' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 4, 'Good communication.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_01@ua.edu'
JOIN users b ON b.email = 'seed_buyer_02@ua.edu' WHERE l.title = 'SEED_TX_S01_B' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 5, NULL
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_02@ua.edu'
JOIN users b ON b.email = 'seed_buyer_03@ua.edu' WHERE l.title = 'SEED_TX_S02_A' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 3, 'Okay — item had minor wear.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_02@ua.edu'
JOIN users b ON b.email = 'seed_buyer_04@ua.edu' WHERE l.title = 'SEED_TX_S02_B' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 2, 'Late pickup, item fine.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_03@ua.edu'
JOIN users b ON b.email = 'seed_buyer_05@ua.edu' WHERE l.title = 'SEED_TX_S03_A' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 4, NULL
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_03@ua.edu'
JOIN users b ON b.email = 'seed_buyer_06@ua.edu' WHERE l.title = 'SEED_TX_S03_B' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 5, 'Super easy handoff.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_04@ua.edu'
JOIN users b ON b.email = 'seed_buyer_07@ua.edu' WHERE l.title = 'SEED_TX_S04_A' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 1, 'No-show twice.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_04@ua.edu'
JOIN users b ON b.email = 'seed_buyer_08@ua.edu' WHERE l.title = 'SEED_TX_S04_B' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 4, 'Would recommend.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_05@ua.edu'
JOIN users b ON b.email = 'seed_buyer_09@ua.edu' WHERE l.title = 'SEED_TX_S05_A' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 5, NULL
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_05@ua.edu'
JOIN users b ON b.email = 'seed_buyer_10@ua.edu' WHERE l.title = 'SEED_TX_S05_B' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 3, 'Average experience.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_06@ua.edu'
JOIN users b ON b.email = 'seed_buyer_11@ua.edu' WHERE l.title = 'SEED_TX_S06_A' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 3, NULL
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_06@ua.edu'
JOIN users b ON b.email = 'seed_buyer_12@ua.edu' WHERE l.title = 'SEED_TX_S06_B' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 5, 'Fast response.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_07@ua.edu'
JOIN users b ON b.email = 'seed_buyer_13@ua.edu' WHERE l.title = 'SEED_TX_S07_A' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 4, NULL
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_07@ua.edu'
JOIN users b ON b.email = 'seed_buyer_14@ua.edu' WHERE l.title = 'SEED_TX_S07_B' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 2, 'Item not as described.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_08@ua.edu'
JOIN users b ON b.email = 'seed_buyer_15@ua.edu' WHERE l.title = 'SEED_TX_S08_A' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 4, 'Resolved after message.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_08@ua.edu'
JOIN users b ON b.email = 'seed_buyer_16@ua.edu' WHERE l.title = 'SEED_TX_S08_B' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 5, NULL
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_09@ua.edu'
JOIN users b ON b.email = 'seed_buyer_17@ua.edu' WHERE l.title = 'SEED_TX_S09_A' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 4, 'Great.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_09@ua.edu'
JOIN users b ON b.email = 'seed_buyer_18@ua.edu' WHERE l.title = 'SEED_TX_S09_B' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 5, 'Five stars.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_10@ua.edu'
JOIN users b ON b.email = 'seed_buyer_01@ua.edu' WHERE l.title = 'SEED_TX_S10_A' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 3, 'Mixed — price was fair.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_10@ua.edu'
JOIN users b ON b.email = 'seed_buyer_02@ua.edu' WHERE l.title = 'SEED_TX_S10_B' LIMIT 1;

-- Extra ratings: second opinion on same seller (different listing) — still unique (listing_id, rater_id, ratee_id)
INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 5, 'Second purchase — also great.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_01@ua.edu'
JOIN users b ON b.email = 'seed_buyer_03@ua.edu' WHERE l.title = 'SEED_TX_S01_B' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 2, 'Rude messages.'
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_03@ua.edu'
JOIN users b ON b.email = 'seed_buyer_07@ua.edu' WHERE l.title = 'SEED_TX_S03_A' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 4, NULL
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_05@ua.edu'
JOIN users b ON b.email = 'seed_buyer_11@ua.edu' WHERE l.title = 'SEED_TX_S05_B' LIMIT 1;

INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
SELECT l.listing_id, b.user_id, s.user_id, 5, NULL
FROM listings l JOIN users s ON s.user_id = l.seller_id AND s.email = 'seed_seller_10@ua.edu'
JOIN users b ON b.email = 'seed_buyer_18@ua.edu' WHERE l.title = 'SEED_TX_S10_A' LIMIT 1;

-- -----------------------------------------------------------------------------
-- Sync denormalized columns on users from ratings (avg + count per ratee)
-- -----------------------------------------------------------------------------
UPDATE users u
JOIN (
    SELECT ratee_id AS uid, ROUND(AVG(score), 2) AS avg_s, COUNT(*) AS cnt
    FROM ratings
    GROUP BY ratee_id
) x ON x.uid = u.user_id
SET u.avg_rating = x.avg_s, u.rating_count = x.cnt;

-- -----------------------------------------------------------------------------
-- Verify (optional)
-- -----------------------------------------------------------------------------
-- SELECT u.email, u.avg_rating, u.rating_count FROM users u WHERE u.email LIKE 'seed_seller_%' ORDER BY u.email;
-- SELECT ratee_id, AVG(score) AS avg_score, COUNT(*) AS n FROM ratings GROUP BY ratee_id ORDER BY ratee_id;

-- =============================================================================
-- CLEANUP (run manually when you want to remove seed data)
-- =============================================================================
-- DELETE r FROM ratings r
-- INNER JOIN listings l ON l.listing_id = r.listing_id
-- WHERE l.title LIKE 'SEED_TX_%';
-- DELETE FROM listings WHERE title LIKE 'SEED_TX_%';
-- DELETE FROM users WHERE email LIKE 'seed_%@ua.edu';
