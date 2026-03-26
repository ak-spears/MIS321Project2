using FullstackWithLlm.Api.Models;
using MySqlConnector;

namespace FullstackWithLlm.Api.Data;

public sealed class ProductRepository
{
    private readonly string _connectionString;

    private static async Task EnsureInitializedAsync(MySqlConnection connection)
    {
        // Idempotent: safe to run on every startup/request.
        const string createTableSql = """
            CREATE TABLE IF NOT EXISTS Products
            (
                Id INT NOT NULL AUTO_INCREMENT,
                Name VARCHAR(120) NOT NULL,
                Price DECIMAL(10,2) NOT NULL,
                PRIMARY KEY (Id)
            );
            """;

        await using (var createCmd = new MySqlCommand(createTableSql, connection))
        {
            await createCmd.ExecuteNonQueryAsync();
        }

        const string seedModelSql = """
            INSERT INTO Products (Name, Price)
            SELECT 'Model Y Charger', 249.99
            WHERE NOT EXISTS (
                SELECT 1 FROM Products WHERE Name = 'Model Y Charger' LIMIT 1
            );
            """;

        await using (var seedModelCmd = new MySqlCommand(seedModelSql, connection))
        {
            await seedModelCmd.ExecuteNonQueryAsync();
        }

        const string seedHomeSql = """
            INSERT INTO Products (Name, Price)
            SELECT 'Home EV Adapter', 129.50
            WHERE NOT EXISTS (
                SELECT 1 FROM Products WHERE Name = 'Home EV Adapter' LIMIT 1
            );
            """;

        await using (var seedHomeCmd = new MySqlCommand(seedHomeSql, connection))
        {
            await seedHomeCmd.ExecuteNonQueryAsync();
        }
    }

    public ProductRepository(IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("Missing connection string: ConnectionStrings:DefaultConnection (env var key: ConnectionStrings__DefaultConnection).");
        }

        _connectionString = connectionString;
    }

    public async Task<IReadOnlyList<Product>> GetAllAsync()
    {
        var products = new List<Product>();

        await using var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync();

        await EnsureInitializedAsync(connection);

        const string sql = """
            SELECT Id, Name, Price
            FROM Products
            ORDER BY Id;
            """;

        await using var command = new MySqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            products.Add(new Product
            {
                Id = reader.GetInt32(0),
                Name = reader.GetString(1),
                Price = reader.GetDecimal(2)
            });
        }

        return products;
    }

    public async Task<int> CreateAsync(Product product)
    {
        await using var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync();

        await EnsureInitializedAsync(connection);

        const string sql = """
            INSERT INTO Products (Name, Price)
            VALUES (@Name, @Price);

            SELECT LAST_INSERT_ID();
            """;

        await using var command = new MySqlCommand(sql, connection);
        command.Parameters.AddWithValue("@Name", product.Name);
        command.Parameters.AddWithValue("@Price", product.Price);

        var newId = await command.ExecuteScalarAsync();
        return Convert.ToInt32(newId);
    }
}
