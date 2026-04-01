-- Optional test data: run after you have at least one campus (seed UA) and one user row.
-- Pick a real seller_id:  SELECT user_id, email FROM users;
-- Pick campus_id (usually 1 for UA):  SELECT campus_id, name FROM campuses;

INSERT INTO listings (campus_id, seller_id, title, description, price, category, image_url, status)
VALUES
    (1, 1, 'Twin XL mattress topper', 'Barely used, smoke-free dorm.', 35.00, 'bedding', NULL, 'active'),
    (1, 1, 'Desk lamp LED', 'Warm light, works great.', 12.00, 'lighting', NULL, 'active');
