using FullstackWithLlm.Api.Models;
using Microsoft.Data.SqlClient;

namespace FullstackWithLlm.Api.Data;

public sealed class ProductRepository
{
    private readonly string _connectionString;

    public ProductRepository(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("Missing connection string: DefaultConnection");
    }

    public async Task<IReadOnlyList<Product>> GetAllAsync()
    {
        var products = new List<Product>();

        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        const string sql = """
            SELECT Id, Name, Price
            FROM Products
            ORDER BY Id;
            """;

        await using var command = new SqlCommand(sql, connection);
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
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        const string sql = """
            INSERT INTO Products (Name, Price)
            OUTPUT INSERTED.Id
            VALUES (@Name, @Price);
            """;

        await using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@Name", product.Name);
        command.Parameters.AddWithValue("@Price", product.Price);

        var newId = await command.ExecuteScalarAsync();
        return Convert.ToInt32(newId);
    }
}
