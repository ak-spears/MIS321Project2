-- ============================================================
-- Campus Dorm Marketplace — canonical MySQL schema
-- Run once against your database (name comes from connection string).
-- Auth/register columns are merged into `users` for the ASP.NET API.
-- ============================================================

-- ============================================================
-- CAMPUSES
-- ============================================================
CREATE TABLE IF NOT EXISTS campuses (
    campus_id     INT           NOT NULL AUTO_INCREMENT,
    name          VARCHAR(100)  NOT NULL,
    subdomain     VARCHAR(30)   NOT NULL UNIQUE,
    email_domain  VARCHAR(50)   NOT NULL UNIQUE,
    primary_color CHAR(7)       NOT NULL DEFAULT '#000000',
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (campus_id)
);

-- ============================================================
-- USERS
-- Includes JWT auth + signup fields used by /api/auth/register.
-- display_name: set on register (derived from email if needed).
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    user_id         INT            NOT NULL AUTO_INCREMENT,
    campus_id       INT            NOT NULL,
    email           VARCHAR(150)   NOT NULL UNIQUE,
    password_hash   VARCHAR(255)   NOT NULL,
    display_name    VARCHAR(60)    NOT NULL,
    phone           VARCHAR(40)    NOT NULL,
    lives_on_campus TINYINT(1)    NOT NULL DEFAULT 0,
    move_in_date    DATE           NOT NULL,
    move_out_date   DATE           DEFAULT NULL,
    dorm_building   VARCHAR(120)   DEFAULT NULL,
    suite_letter    CHAR(1)        DEFAULT NULL,
    avatar_url      MEDIUMTEXT     DEFAULT NULL,
    default_gap_solution   VARCHAR(32) DEFAULT NULL COMMENT 'seller default listing fulfillment',
    preferred_receive_gap  VARCHAR(32) DEFAULT NULL COMMENT 'buyer preference — storage | pickup_window | ship_or_deliver',
    avg_rating      DECIMAL(3,2)   NOT NULL DEFAULT 0.00,
    rating_count    INT            NOT NULL DEFAULT 0,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_user_campus FOREIGN KEY (campus_id)
        REFERENCES campuses (campus_id) ON DELETE RESTRICT
);

-- ============================================================
-- LISTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS listings (
    listing_id  INT            NOT NULL AUTO_INCREMENT,
    campus_id   INT            NOT NULL,
    seller_id   INT            NOT NULL,
    title       VARCHAR(150)   NOT NULL,
    description TEXT           DEFAULT NULL,
    price       DECIMAL(8,2)   NOT NULL DEFAULT 0.00,
    category    VARCHAR(50)    DEFAULT NULL,
    item_condition VARCHAR(32) DEFAULT NULL COMMENT 'new | like_new | good | fair',
    dimensions  VARCHAR(120)   DEFAULT NULL,
    gap_solution   VARCHAR(32) DEFAULT NULL,
    storage_notes  TEXT        DEFAULT NULL,
    pickup_start   DATE        DEFAULT NULL,
    pickup_end     DATE        DEFAULT NULL,
    pickup_location VARCHAR(255) DEFAULT NULL,
    delivery_notes TEXT        DEFAULT NULL,
    space_suitability VARCHAR(32) DEFAULT NULL COMMENT 'small_dorm | any_space — dorm space fit',
    image_url   MEDIUMTEXT     DEFAULT NULL,
    status      ENUM('active','pending','sold','removed') NOT NULL DEFAULT 'active',
    created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (listing_id),
    CONSTRAINT fk_listing_campus FOREIGN KEY (campus_id)
        REFERENCES campuses (campus_id) ON DELETE RESTRICT,
    CONSTRAINT fk_listing_seller FOREIGN KEY (seller_id)
        REFERENCES users (user_id) ON DELETE RESTRICT
);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id  INT            NOT NULL AUTO_INCREMENT,
    listing_id      INT            NOT NULL,
    buyer_id        INT            NOT NULL,
    seller_id       INT            NOT NULL,
    amount          DECIMAL(8,2)   NOT NULL DEFAULT 0.00,
    platform_fee    DECIMAL(8,2)   NOT NULL DEFAULT 0.00,
    payment_method  ENUM('cash','card') NOT NULL DEFAULT 'cash',
    status          ENUM('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
    claimed_at      DATETIME       DEFAULT NULL,
    completed_at    DATETIME       DEFAULT NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (transaction_id),
    CONSTRAINT fk_txn_listing FOREIGN KEY (listing_id)
        REFERENCES listings (listing_id) ON DELETE RESTRICT,
    CONSTRAINT fk_txn_buyer FOREIGN KEY (buyer_id)
        REFERENCES users (user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_txn_seller FOREIGN KEY (seller_id)
        REFERENCES users (user_id) ON DELETE RESTRICT
);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
    message_id  INT          NOT NULL AUTO_INCREMENT,
    listing_id  INT          NOT NULL,
    sender_id   INT          NOT NULL,
    receiver_id INT          NOT NULL,
    body        TEXT         NOT NULL,
    is_read     TINYINT(1)   NOT NULL DEFAULT 0,
    sent_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id),
    CONSTRAINT fk_msg_listing  FOREIGN KEY (listing_id)
        REFERENCES listings (listing_id) ON DELETE CASCADE,
    CONSTRAINT fk_msg_sender   FOREIGN KEY (sender_id)
        REFERENCES users (user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_msg_receiver FOREIGN KEY (receiver_id)
        REFERENCES users (user_id) ON DELETE RESTRICT
);

-- ============================================================
-- RATINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS ratings (
    rating_id   INT          NOT NULL AUTO_INCREMENT,
    listing_id  INT          NOT NULL,
    rater_id    INT          NOT NULL,
    ratee_id    INT          NOT NULL,
    score       TINYINT      NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment     VARCHAR(500) DEFAULT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (rating_id),
    UNIQUE KEY uq_one_rating_per_pair (listing_id, rater_id, ratee_id),
    CONSTRAINT fk_rating_listing FOREIGN KEY (listing_id)
        REFERENCES listings (listing_id) ON DELETE CASCADE,
    CONSTRAINT fk_rating_rater  FOREIGN KEY (rater_id)
        REFERENCES users (user_id) ON DELETE RESTRICT,
    CONSTRAINT fk_rating_ratee  FOREIGN KEY (ratee_id)
        REFERENCES users (user_id) ON DELETE RESTRICT
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_listings_campus_status ON listings (campus_id, status);
CREATE INDEX idx_listings_seller        ON listings (seller_id);
CREATE INDEX idx_listings_category      ON listings (campus_id, category, status);
CREATE INDEX idx_messages_listing       ON messages (listing_id, sent_at);
CREATE INDEX idx_messages_receiver      ON messages (receiver_id, is_read);
CREATE INDEX idx_txn_buyer              ON transactions (buyer_id);
CREATE INDEX idx_txn_seller             ON transactions (seller_id);
CREATE INDEX idx_users_campus           ON users (campus_id);

-- ============================================================
-- SEED: University of Alabama (campus_id = 1)
-- ============================================================
INSERT INTO campuses (name, subdomain, email_domain, primary_color)
SELECT 'University of Alabama', 'ua', 'ua.edu', '#9E1B32'
WHERE NOT EXISTS (SELECT 1 FROM campuses WHERE subdomain = 'ua' LIMIT 1);
