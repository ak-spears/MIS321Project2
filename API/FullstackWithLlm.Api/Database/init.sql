IF DB_ID('FullstackWithLlmDb') IS NULL
BEGIN
    CREATE DATABASE FullstackWithLlmDb;
END
GO

USE FullstackWithLlmDb;
GO

IF OBJECT_ID('dbo.Products', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Products
    (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Name NVARCHAR(120) NOT NULL,
        Price DECIMAL(10,2) NOT NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Products)
BEGIN
    INSERT INTO dbo.Products (Name, Price)
    VALUES
        ('Model Y Charger', 249.99),
        ('Home EV Adapter', 129.50);
END
GO
