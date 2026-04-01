using FullstackWithLlm.Api.Models;
using MySqlConnector;

namespace FullstackWithLlm.Api.Data;

public sealed class ListingRepository
{
    private readonly string _connectionString;

    public ListingRepository(IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "Missing connection string: ConnectionStrings:DefaultConnection (env: ConnectionStrings__DefaultConnection).");
        }

        _connectionString = connectionString;
    }

    public async Task<IReadOnlyList<ListingFeedItemDto>> GetFeedAsync(
        int limit,
        int? campusId,
        CancellationToken cancellationToken = default)
    {
        const string sql = """
            SELECT
                l.listing_id,
                l.title,
                l.description,
                l.price,
                l.category,
                l.image_url,
                l.status,
                l.created_at,
                u.display_name AS seller_display_name
            FROM listings l
            INNER JOIN users u ON u.user_id = l.seller_id
            WHERE l.status = 'active'
              AND (@campus_id IS NULL OR l.campus_id = @campus_id)
            ORDER BY l.created_at DESC
            LIMIT @limit;
            """;

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@limit", limit);
        cmd.Parameters.AddWithValue("@campus_id", campusId.HasValue ? campusId.Value : DBNull.Value);

        var list = new List<ListingFeedItemDto>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(
                new ListingFeedItemDto
                {
                    ListingId = reader.GetInt32(reader.GetOrdinal("listing_id")),
                    Title = reader.GetString(reader.GetOrdinal("title")),
                    Description = reader.IsDBNull(reader.GetOrdinal("description"))
                        ? null
                        : reader.GetString(reader.GetOrdinal("description")),
                    Price = reader.GetDecimal(reader.GetOrdinal("price")),
                    Category = reader.IsDBNull(reader.GetOrdinal("category"))
                        ? null
                        : reader.GetString(reader.GetOrdinal("category")),
                    ImageUrl = reader.IsDBNull(reader.GetOrdinal("image_url"))
                        ? null
                        : reader.GetString(reader.GetOrdinal("image_url")),
                    Status = reader.GetString(reader.GetOrdinal("status")),
                    SellerDisplayName = reader.GetString(reader.GetOrdinal("seller_display_name")),
                    CreatedAt = reader.GetDateTime(reader.GetOrdinal("created_at")),
                });
        }

        return list;
    }

    public async Task<ListingDetailDto?> GetByIdAsync(int listingId, CancellationToken cancellationToken = default)
    {
        const string sql = """
            SELECT
                l.listing_id,
                l.title,
                l.description,
                l.price,
                l.category,
                l.image_url,
                l.status,
                l.created_at,
                u.display_name AS seller_display_name
            FROM listings l
            INNER JOIN users u ON u.user_id = l.seller_id
            WHERE l.listing_id = @id
            LIMIT 1;
            """;

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", listingId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new ListingDetailDto
        {
            ListingId = reader.GetInt32(reader.GetOrdinal("listing_id")),
            Title = reader.GetString(reader.GetOrdinal("title")),
            Description = reader.IsDBNull(reader.GetOrdinal("description"))
                ? null
                : reader.GetString(reader.GetOrdinal("description")),
            Price = reader.GetDecimal(reader.GetOrdinal("price")),
            Category = reader.IsDBNull(reader.GetOrdinal("category")) ? null : reader.GetString(reader.GetOrdinal("category")),
            ImageUrl = reader.IsDBNull(reader.GetOrdinal("image_url")) ? null : reader.GetString(reader.GetOrdinal("image_url")),
            Status = reader.GetString(reader.GetOrdinal("status")),
            SellerDisplayName = reader.GetString(reader.GetOrdinal("seller_display_name")),
            CreatedAt = reader.GetDateTime(reader.GetOrdinal("created_at")),
        };
    }
}
