-- Campus Dorm Marketplace MySQL schema
-- Note: on Heroku the database/schema name comes from the connection string.
-- This file should ONLY create tables in the currently-selected database.

CREATE TABLE IF NOT EXISTS Products
(
    Id INT NOT NULL AUTO_INCREMENT,
    Name VARCHAR(120) NOT NULL,
    Price DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (Id)
);

INSERT INTO Products (Name, Price)
SELECT 'Model Y Charger', 249.99
WHERE NOT EXISTS (SELECT 1 FROM Products WHERE Name = 'Model Y Charger' LIMIT 1);

INSERT INTO Products (Name, Price)
SELECT 'Home EV Adapter', 129.50
WHERE NOT EXISTS (SELECT 1 FROM Products WHERE Name = 'Home EV Adapter' LIMIT 1);
