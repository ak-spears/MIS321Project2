-- =============================================================================
-- Catch-up script: add columns/tables the ASP.NET API expects.
-- Idempotent: checks INFORMATION_SCHEMA; safe to re-run.
-- Run in MySQL Workbench (same DB as DATABASE_URL) or: mysql < catchup...sql
-- =============================================================================
SET @db := DATABASE();

-- ----- Helper: add column to users if missing -----
SET @t := 'users';
SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'display_name';
SET @s := IF(@c = 0,
  'ALTER TABLE users ADD COLUMN display_name VARCHAR(60) NOT NULL DEFAULT ''User''',
  'SELECT ''users.display_name already exists'' AS _msg');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'default_gap_solution';
SET @s := IF(@c = 0,
  'ALTER TABLE users ADD COLUMN default_gap_solution VARCHAR(32) NULL COMMENT ''storage | pickup_window | ship_or_deliver''',
  'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'preferred_receive_gap';
SET @s := IF(@c = 0,
  'ALTER TABLE users ADD COLUMN preferred_receive_gap VARCHAR(32) NULL',
  'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'on_probation';
SET @s := IF(@c = 0,
  'ALTER TABLE users ADD COLUMN on_probation TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

-- Signup / profile columns (UserRepository — INSERT + SELECT use these)
SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone';
SET @s := IF(@c = 0,
  'ALTER TABLE users ADD COLUMN phone VARCHAR(40) NOT NULL DEFAULT ''''',
  'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'lives_on_campus';
SET @s := IF(@c = 0,
  'ALTER TABLE users ADD COLUMN lives_on_campus TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'move_in_date';
SET @s := IF(@c = 0,
  'ALTER TABLE users ADD COLUMN move_in_date DATE NOT NULL DEFAULT ''2000-01-01''',
  'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'move_out_date';
SET @s := IF(@c = 0, 'ALTER TABLE users ADD COLUMN move_out_date DATE NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'dorm_building';
SET @s := IF(@c = 0, 'ALTER TABLE users ADD COLUMN dorm_building VARCHAR(120) NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'suite_letter';
SET @s := IF(@c = 0, 'ALTER TABLE users ADD COLUMN suite_letter CHAR(1) NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar_url';
SET @s := IF(@c = 0, 'ALTER TABLE users ADD COLUMN avatar_url MEDIUMTEXT NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

-- Widen avatar if not MEDIUMTEXT
SELECT DATA_TYPE INTO @uadt
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar_url' LIMIT 1;
SET @s := IF(@uadt IS NOT NULL AND LOWER(@uadt) <> 'mediumtext',
  'ALTER TABLE users MODIFY COLUMN avatar_url MEDIUMTEXT NULL',
  'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avg_rating';
SET @s := IF(@c = 0, 'ALTER TABLE users ADD COLUMN avg_rating DECIMAL(3,2) NOT NULL DEFAULT 0.00', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'rating_count';
SET @s := IF(@c = 0, 'ALTER TABLE users ADD COLUMN rating_count INT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'created_at';
SET @s := IF(@c = 0, 'ALTER TABLE users ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

-- ----- Listings: one column at a time (no multi-ADD) -----
SET @t := 'listings';
SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'gap_solution';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN gap_solution VARCHAR(32) NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'storage_notes';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN storage_notes TEXT NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'pickup_start';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN pickup_start DATE NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'pickup_end';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN pickup_end DATE NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'pickup_location';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN pickup_location VARCHAR(255) NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'delivery_notes';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN delivery_notes TEXT NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'item_condition';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN item_condition VARCHAR(32) NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'dimensions';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN dimensions VARCHAR(120) NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'space_suitability';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN space_suitability VARCHAR(32) NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'or_best_offer';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN or_best_offer TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'donation_handed_off_at';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN donation_handed_off_at DATETIME NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'image_url';
SET @s := IF(@c = 0, 'ALTER TABLE listings ADD COLUMN image_url MEDIUMTEXT NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT DATA_TYPE INTO @lidt
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'listings' AND COLUMN_NAME = 'image_url' LIMIT 1;
SET @s := IF(@lidt IS NOT NULL AND LOWER(@lidt) <> 'mediumtext',
  'ALTER TABLE listings MODIFY COLUMN image_url MEDIUMTEXT NULL',
  'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

-- ----- Transactions (handshake + fee) -----
SET @t := 'transactions';
SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'buyer_confirmed_at';
SET @s := IF(@c = 0, 'ALTER TABLE transactions ADD COLUMN buyer_confirmed_at DATETIME NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'seller_confirmed_at';
SET @s := IF(@c = 0, 'ALTER TABLE transactions ADD COLUMN seller_confirmed_at DATETIME NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'fee_paid_at';
SET @s := IF(@c = 0, 'ALTER TABLE transactions ADD COLUMN fee_paid_at DATETIME NULL', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'obo_seller_ack';
SET @s := IF(@c = 0, 'ALTER TABLE transactions ADD COLUMN obo_seller_ack TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1 = seller accepted buyer OBO price (below list)''', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

-- ----- Ratings moderation -----
SET @t := 'ratings';
SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'is_flagged';
SET @s := IF(@c = 0, 'ALTER TABLE ratings ADD COLUMN is_flagged TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

SELECT COUNT(*) INTO @c FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @t AND COLUMN_NAME = 'is_harsh';
SET @s := IF(@c = 0, 'ALTER TABLE ratings ADD COLUMN is_harsh TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE _p FROM @s; EXECUTE _p; DEALLOCATE PREPARE _p;

-- ----- listing_scores (if whole table missing) -----
CREATE TABLE IF NOT EXISTS listing_scores (
    listing_id INT NOT NULL,
    user_id INT NOT NULL,
    score INT NOT NULL,
    reason VARCHAR(255) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (listing_id, user_id)
);

-- Indexes (ignore error if exist)
SET @s := 'CREATE INDEX idx_listing_scores_user ON listing_scores (user_id, score, created_at)';
-- Optional: only if your MySQL version supports IF NOT EXISTS for index — skip to avoid errors on old DBs

SELECT 'catchup_api_schema_idempotent: done' AS result;
