using FullstackWithLlm.Api.Models;
using MySqlConnector;

namespace FullstackWithLlm.Api.Data;

public sealed class TransactionRepository
{
    private const decimal PlatformFeeRate = 0.07m;

    private readonly string _connectionString;

    public TransactionRepository(IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "Missing connection string: ConnectionStrings:DefaultConnection (env: ConnectionStrings__DefaultConnection).");
        }

        _connectionString = connectionString;
    }

    public async Task<IReadOnlyList<TransactionListItemDto>> GetMineAsBuyerAsync(
        int buyerId,
        int limit,
        CancellationToken cancellationToken = default)
    {
        if (limit < 1)
        {
            limit = 48;
        }

        if (limit > 200)
        {
            limit = 200;
        }

        // LEFT JOIN so a transaction row still appears if the listing row was removed (INNER JOIN hid rows).
        const string sql = """
            SELECT
                t.transaction_id,
                t.listing_id,
                COALESCE(l.title, '(listing unavailable)') AS title,
                t.amount,
                t.platform_fee,
                t.payment_method,
                t.status,
                t.created_at
            FROM transactions t
            LEFT JOIN listings l ON l.listing_id = t.listing_id
            WHERE t.buyer_id = @buyer_id
            ORDER BY t.created_at DESC
            LIMIT @limit;
            """;

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@buyer_id", buyerId);
        cmd.Parameters.AddWithValue("@limit", limit);

        var list = new List<TransactionListItemDto>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(new TransactionListItemDto
            {
                TransactionId = reader.GetInt32(reader.GetOrdinal("transaction_id")),
                ListingId = reader.GetInt32(reader.GetOrdinal("listing_id")),
                Title = reader.GetString(reader.GetOrdinal("title")),
                Amount = reader.GetDecimal(reader.GetOrdinal("amount")),
                PlatformFee = reader.GetDecimal(reader.GetOrdinal("platform_fee")),
                PaymentMethod = reader.GetString(reader.GetOrdinal("payment_method")),
                Status = reader.GetString(reader.GetOrdinal("status")),
                CreatedAt = reader.GetDateTime(reader.GetOrdinal("created_at")),
            });
        }

        return list;
    }

    /// <summary>
    /// Creates a transaction and marks the listing sold. Returns null if listing unavailable or invalid.
    /// </summary>
    public async Task<TransactionListItemDto?> CreateCheckoutAsync(
        int buyerId,
        int listingId,
        string paymentMethod,
        CancellationToken cancellationToken = default)
    {
        paymentMethod = paymentMethod.Trim().ToLowerInvariant();
        if (paymentMethod != "cash" && paymentMethod != "card")
        {
            paymentMethod = "cash";
        }

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var dbTx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            const string selectSql = """
                SELECT seller_id, price, status, title
                FROM listings
                WHERE listing_id = @lid
                FOR UPDATE;
                """;

            int sellerId;
            decimal price;
            string status;
            string listingTitle;

            await using (var selectCmd = new MySqlCommand(selectSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@lid", listingId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }

                sellerId = reader.GetInt32(reader.GetOrdinal("seller_id"));
                price = reader.GetDecimal(reader.GetOrdinal("price"));
                status = reader.GetString(reader.GetOrdinal("status"));
                listingTitle = reader.GetString(reader.GetOrdinal("title"));
                await reader.CloseAsync();
            }

            if (!string.Equals(status, "active", StringComparison.OrdinalIgnoreCase))
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            if (sellerId == buyerId)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            var platformFee = price > 0 ? Math.Round(price * PlatformFeeRate, 2, MidpointRounding.AwayFromZero) : 0m;

            const string insertSql = """
                INSERT INTO transactions (
                    listing_id, buyer_id, seller_id, amount, platform_fee, payment_method, status, claimed_at
                )
                VALUES (
                    @lid, @buyer, @seller, @amount, @fee, @pm, 'pending', UTC_TIMESTAMP()
                );
                """;

            int newId;
            await using (var insertCmd = new MySqlCommand(insertSql, conn, dbTx))
            {
                insertCmd.Parameters.AddWithValue("@lid", listingId);
                insertCmd.Parameters.AddWithValue("@buyer", buyerId);
                insertCmd.Parameters.AddWithValue("@seller", sellerId);
                insertCmd.Parameters.AddWithValue("@amount", price);
                insertCmd.Parameters.AddWithValue("@fee", platformFee);
                insertCmd.Parameters.AddWithValue("@pm", paymentMethod);
                await insertCmd.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var idCmd = new MySqlCommand("SELECT LAST_INSERT_ID();", conn, dbTx))
            {
                var scalar = await idCmd.ExecuteScalarAsync(cancellationToken);
                newId = Convert.ToInt32(scalar);
            }

            if (newId <= 0)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            const string updateSql = """
                UPDATE listings
                SET status = 'sold'
                WHERE listing_id = @lid AND status = 'active';
                """;

            await using (var updateCmd = new MySqlCommand(updateSql, conn, dbTx))
            {
                updateCmd.Parameters.AddWithValue("@lid", listingId);
                var n = await updateCmd.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }
            }

            await dbTx.CommitAsync(cancellationToken);

            DateTime createdAtRow;
            await using (var readCmd = new MySqlCommand(
                           "SELECT created_at FROM transactions WHERE transaction_id = @tid;",
                           conn))
            {
                readCmd.Parameters.AddWithValue("@tid", newId);
                var scalar = await readCmd.ExecuteScalarAsync(cancellationToken);
                createdAtRow = scalar is DateTime dt ? dt : DateTime.UtcNow;
            }

            return new TransactionListItemDto
            {
                TransactionId = newId,
                ListingId = listingId,
                Title = listingTitle,
                Amount = price,
                PlatformFee = platformFee,
                PaymentMethod = paymentMethod,
                Status = "pending",
                CreatedAt = createdAtRow,
            };
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }
    }
}
