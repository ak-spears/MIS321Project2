-- Add user fulfillment preference columns (safe/re-runnable).
-- MySQL doesn't universally support "ADD COLUMN IF NOT EXISTS", so we guard via INFORMATION_SCHEMA.
--
-- Columns:
-- - default_gap_solution: seller default listing fulfillment (storage | pickup_window | ship_or_deliver)
-- - preferred_receive_gap: buyer preferred receive method (storage | pickup_window | ship_or_deliver)
--
-- Run this against the same database/schema your API connection string points to.

SET @db := DATABASE();

-- default_gap_solution
SELECT COUNT(*) INTO @has_default_gap
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'default_gap_solution';

SET @sql_default_gap := IF(
  @has_default_gap = 0,
  "ALTER TABLE users ADD COLUMN default_gap_solution VARCHAR(32) NULL COMMENT 'storage | pickup_window | ship_or_deliver — seller default' AFTER avatar_url;",
  "SELECT 'users.default_gap_solution already exists' AS info;"
);
PREPARE stmt_default_gap FROM @sql_default_gap;
EXECUTE stmt_default_gap;
DEALLOCATE PREPARE stmt_default_gap;

-- preferred_receive_gap
SELECT COUNT(*) INTO @has_preferred_receive
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'preferred_receive_gap';

SET @sql_preferred_receive := IF(
  @has_preferred_receive = 0,
  "ALTER TABLE users ADD COLUMN preferred_receive_gap VARCHAR(32) NULL COMMENT 'storage | pickup_window | ship_or_deliver — buyer preference';",
  "SELECT 'users.preferred_receive_gap already exists' AS info;"
);
PREPARE stmt_preferred_receive FROM @sql_preferred_receive;
EXECUTE stmt_preferred_receive;
DEALLOCATE PREPARE stmt_preferred_receive;

