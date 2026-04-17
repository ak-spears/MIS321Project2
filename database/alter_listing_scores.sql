CREATE TABLE IF NOT EXISTS listing_scores (
    listing_id INT NOT NULL,
    user_id INT NOT NULL,
    score INT NOT NULL,
    reason VARCHAR(255) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (listing_id, user_id),
    CONSTRAINT fk_listing_scores_listing FOREIGN KEY (listing_id)
        REFERENCES listings (listing_id) ON DELETE CASCADE,
    CONSTRAINT fk_listing_scores_user FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE INDEX idx_listing_scores_user ON listing_scores (user_id, score, created_at);
