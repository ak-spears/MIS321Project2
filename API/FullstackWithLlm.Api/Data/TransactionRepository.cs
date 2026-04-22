using FullstackWithLlm.Api.Models;
using MySqlConnector;

namespace FullstackWithLlm.Api.Data;

public sealed class TransactionRepository
{
    private const decimal PlatformFeeRate = 0.07m;

    private readonly string _connectionString;

    public enum ConfirmCompletionOutcome
    {
        Ok,
        NotFound,
        Forbidden,
        Conflict,
    }

    public enum MoveToDonationOutcome
    {
        Ok,
        NotFound,
        Forbidden,
        Conflict,
    }

    public enum CancelBySellerOutcome
    {
        Ok,
        NotFound,
        Forbidden,
        Conflict,
    }

    public sealed class ConfirmCompletionResult
    {
        public ConfirmCompletionOutcome Outcome { get; init; }
        public TransactionListItemDto? Row { get; init; }
    }

    public sealed class MoveToDonationResult
    {
        public MoveToDonationOutcome Outcome { get; init; }
        public int ListingId { get; init; }
        public int TransactionId { get; init; }
    }

    public sealed class CancelBySellerResult
    {
        public CancelBySellerOutcome Outcome { get; init; }
        public int ListingId { get; init; }
        public int TransactionId { get; init; }
    }

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
                t.created_at,
                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM ratings r
                        WHERE r.listing_id = t.listing_id
                          AND r.rater_id = t.buyer_id
                          AND r.ratee_id = t.seller_id
                    ) THEN 1
                    ELSE 0
                END AS has_rating
            FROM transactions t
            LEFT JOIN listings l ON l.listing_id = t.listing_id
            LEFT JOIN users su ON su.user_id = t.seller_id
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
                HasRating = !reader.IsDBNull(reader.GetOrdinal("has_rating")) && reader.GetInt32(reader.GetOrdinal("has_rating")) == 1,
                CreatedAt = reader.GetDateTime(reader.GetOrdinal("created_at")),
            });
        }

        return list;
    }

    public async Task<IReadOnlyList<SellerSaleListItemDto>> GetMineAsSellerAsync(
        int sellerId,
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

        const string sql = """
            SELECT
                t.transaction_id,
                t.listing_id,
                COALESCE(l.title, '(listing unavailable)') AS title,
                t.buyer_id,
                COALESCE(NULLIF(TRIM(u.display_name), ''), SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1), CONCAT('User #', t.buyer_id)) AS buyer_display_name,
                t.status,
                t.created_at
            FROM transactions t
            LEFT JOIN listings l ON l.listing_id = t.listing_id
            LEFT JOIN users u ON u.user_id = t.buyer_id
            WHERE t.seller_id = @seller_id
              AND t.status = 'pending'
            ORDER BY t.created_at DESC
            LIMIT @limit;
            """;

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@seller_id", sellerId);
        cmd.Parameters.AddWithValue("@limit", limit);

        var list = new List<SellerSaleListItemDto>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(new SellerSaleListItemDto
            {
                TransactionId = reader.GetInt32(reader.GetOrdinal("transaction_id")),
                ListingId = reader.GetInt32(reader.GetOrdinal("listing_id")),
                Title = reader.GetString(reader.GetOrdinal("title")),
                BuyerId = reader.GetInt32(reader.GetOrdinal("buyer_id")),
                BuyerDisplayName = reader.IsDBNull(reader.GetOrdinal("buyer_display_name"))
                    ? ""
                    : reader.GetString(reader.GetOrdinal("buyer_display_name")),
                Status = reader.GetString(reader.GetOrdinal("status")),
                CreatedAt = reader.GetDateTime(reader.GetOrdinal("created_at")),
                SellerId = reader.GetInt32(reader.GetOrdinal("seller_id")),
                SellerDisplayName = reader.GetString(reader.GetOrdinal("seller_display_name")),
                BuyerConfirmed = !reader.IsDBNull(reader.GetOrdinal("buyer_confirmed_at")),
                SellerConfirmed = !reader.IsDBNull(reader.GetOrdinal("seller_confirmed_at")),
            });
        }

        return list;
    }

    /// <summary>Seller&apos;s completed checkouts (same row shape as buyer list; includes buyer for coordination).</summary>
    public async Task<IReadOnlyList<TransactionListItemDto>> GetMineAsSellerAsync(
        int sellerId,
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

        const string sql = """
            SELECT
                t.transaction_id,
                t.listing_id,
                COALESCE(l.title, '(listing unavailable)') AS title,
                t.amount,
                t.platform_fee,
                t.payment_method,
                t.status,
                t.created_at,
                t.seller_id,
                t.buyer_id,
                t.buyer_confirmed_at,
                t.seller_confirmed_at,
                COALESCE(b.display_name, '(buyer)') AS buyer_display_name
            FROM transactions t
            LEFT JOIN listings l ON l.listing_id = t.listing_id
            LEFT JOIN users b ON b.user_id = t.buyer_id
            WHERE t.seller_id = @seller_id
            ORDER BY t.created_at DESC
            LIMIT @limit;
            """;

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@seller_id", sellerId);
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
                SellerId = reader.GetInt32(reader.GetOrdinal("seller_id")),
                BuyerId = reader.GetInt32(reader.GetOrdinal("buyer_id")),
                BuyerDisplayName = reader.GetString(reader.GetOrdinal("buyer_display_name")),
                BuyerConfirmed = !reader.IsDBNull(reader.GetOrdinal("buyer_confirmed_at")),
                SellerConfirmed = !reader.IsDBNull(reader.GetOrdinal("seller_confirmed_at")),
            });
        }

        return list;
    }

    /// <summary>
    /// Claims (reserves) a listing and creates a pending transaction row.
    /// Payment is not captured here; completion happens when the buyer marks the item received.
    /// Returns null if listing unavailable or invalid.
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
                SET status = 'claimed'
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
                SellerId = sellerId,
                BuyerId = buyerId,
                BuyerConfirmed = false,
                SellerConfirmed = false,
            };
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    /// <summary>
    /// Marks a pending transaction completed (buyer received item) and flips listing from claimed → sold.
    /// Returns null if the transaction is not pending, not owned by buyer, or listing is not in claimed state.
    /// </summary>
    public async Task<TransactionListItemDto?> CompleteOnReceiptAsync(
        int buyerId,
        int transactionId,
        CancellationToken cancellationToken = default)
    {
        if (transactionId <= 0)
        {
            return null;
        }

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var dbTx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            const string selectTxSql = """
                SELECT
                    t.transaction_id,
                    t.listing_id,
                    t.amount,
                    t.platform_fee,
                    t.payment_method,
                    t.status,
                    t.created_at,
                    COALESCE(l.title, '(listing unavailable)') AS title,
                    COALESCE(l.status, '') AS listing_status
                FROM transactions t
                LEFT JOIN listings l ON l.listing_id = t.listing_id
                WHERE t.transaction_id = @tid AND t.buyer_id = @buyer
                FOR UPDATE;
                """;

            int listingId;
            string status;
            string title;
            string listingStatus;
            decimal amount;
            decimal platformFee;
            string paymentMethod;
            DateTime createdAt;

            await using (var selectCmd = new MySqlCommand(selectTxSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@tid", transactionId);
                selectCmd.Parameters.AddWithValue("@buyer", buyerId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }

                listingId = reader.GetInt32(reader.GetOrdinal("listing_id"));
                amount = reader.GetDecimal(reader.GetOrdinal("amount"));
                platformFee = reader.GetDecimal(reader.GetOrdinal("platform_fee"));
                paymentMethod = reader.GetString(reader.GetOrdinal("payment_method"));
                status = reader.GetString(reader.GetOrdinal("status"));
                createdAt = reader.GetDateTime(reader.GetOrdinal("created_at"));
                title = reader.GetString(reader.GetOrdinal("title"));
                listingStatus = reader.GetString(reader.GetOrdinal("listing_status"));
                await reader.CloseAsync();
            }

            if (!string.Equals(status, "pending", StringComparison.OrdinalIgnoreCase))
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            const string updateListingSql = """
                UPDATE listings
                SET status = 'sold'
                WHERE listing_id = @lid AND status = 'claimed';
                """;

            await using (var updateListing = new MySqlCommand(updateListingSql, conn, dbTx))
            {
                updateListing.Parameters.AddWithValue("@lid", listingId);
                var n = await updateListing.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }
            }

            const string updateTxSql = """
                UPDATE transactions
                SET status = 'completed'
                WHERE transaction_id = @tid AND buyer_id = @buyer AND status = 'pending';
                """;

            await using (var updateTx = new MySqlCommand(updateTxSql, conn, dbTx))
            {
                updateTx.Parameters.AddWithValue("@tid", transactionId);
                updateTx.Parameters.AddWithValue("@buyer", buyerId);
                var n = await updateTx.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }
            }

            await dbTx.CommitAsync(cancellationToken);

            return new TransactionListItemDto
            {
                TransactionId = transactionId,
                ListingId = listingId,
                Title = title,
                Amount = amount,
                PlatformFee = platformFee,
                PaymentMethod = paymentMethod,
                Status = "completed",
                CreatedAt = createdAt,
            };
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    /// <summary>
    /// Buyer releases a claim before completion: flips listing claimed → active and marks the transaction cancelled.
    /// Returns null if the transaction is not pending, not owned by buyer, or listing is not currently claimed.
    /// </summary>
    public async Task<TransactionListItemDto?> ReleaseClaimAsync(
        int buyerId,
        int transactionId,
        CancellationToken cancellationToken = default)
    {
        if (transactionId <= 0)
        {
            return null;
        }

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var dbTx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            const string selectTxSql = """
                SELECT
                    t.transaction_id,
                    t.listing_id,
                    t.amount,
                    t.platform_fee,
                    t.payment_method,
                    t.status,
                    t.created_at,
                    COALESCE(l.title, '(listing unavailable)') AS title,
                    COALESCE(l.status, '') AS listing_status
                FROM transactions t
                LEFT JOIN listings l ON l.listing_id = t.listing_id
                WHERE t.transaction_id = @tid AND t.buyer_id = @buyer
                FOR UPDATE;
                """;

            int listingId;
            string status;
            string title;
            string listingStatus;
            decimal amount;
            decimal platformFee;
            string paymentMethod;
            DateTime createdAt;

            await using (var selectCmd = new MySqlCommand(selectTxSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@tid", transactionId);
                selectCmd.Parameters.AddWithValue("@buyer", buyerId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }

                listingId = reader.GetInt32(reader.GetOrdinal("listing_id"));
                amount = reader.GetDecimal(reader.GetOrdinal("amount"));
                platformFee = reader.GetDecimal(reader.GetOrdinal("platform_fee"));
                paymentMethod = reader.GetString(reader.GetOrdinal("payment_method"));
                status = reader.GetString(reader.GetOrdinal("status"));
                createdAt = reader.GetDateTime(reader.GetOrdinal("created_at"));
                title = reader.GetString(reader.GetOrdinal("title"));
                listingStatus = reader.GetString(reader.GetOrdinal("listing_status"));
                await reader.CloseAsync();
            }

            if (!string.Equals(status, "pending", StringComparison.OrdinalIgnoreCase))
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            // Be tolerant: sometimes listing status can drift (manual edits, repeated clicks).
            // If it's already active, treat release as idempotent. Only block sold/removed.
            var listingStatusNorm = (listingStatus ?? "").Trim().ToLowerInvariant();
            if (listingStatusNorm == "claimed")
            {
                const string updateListingSql = """
                    UPDATE listings
                    SET status = 'active'
                    WHERE listing_id = @lid AND status = 'claimed';
                    """;

                await using var updateListing = new MySqlCommand(updateListingSql, conn, dbTx);
                updateListing.Parameters.AddWithValue("@lid", listingId);
                var n = await updateListing.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }
            }
            else if (listingStatusNorm == "active" || listingStatusNorm == "")
            {
                // ok: already released / never claimed correctly (some DBs have NULL/blank status)
                const string normalizeListingSql = """
                    UPDATE listings
                    SET status = 'active'
                    WHERE listing_id = @lid AND (status IS NULL OR TRIM(status) = '');
                    """;
                await using var normalizeListing = new MySqlCommand(normalizeListingSql, conn, dbTx);
                normalizeListing.Parameters.AddWithValue("@lid", listingId);
                await normalizeListing.ExecuteNonQueryAsync(cancellationToken);
            }
            else
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            const string updateTxSql = """
                UPDATE transactions
                SET status = 'cancelled'
                WHERE transaction_id = @tid AND buyer_id = @buyer AND status = 'pending';
                """;

            await using (var updateTx = new MySqlCommand(updateTxSql, conn, dbTx))
            {
                updateTx.Parameters.AddWithValue("@tid", transactionId);
                updateTx.Parameters.AddWithValue("@buyer", buyerId);
                var n = await updateTx.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }
            }

            await dbTx.CommitAsync(cancellationToken);

            return new TransactionListItemDto
            {
                TransactionId = transactionId,
                ListingId = listingId,
                Title = title,
                Amount = amount,
                PlatformFee = platformFee,
                PaymentMethod = paymentMethod,
                Status = "cancelled",
                CreatedAt = createdAt,
            };
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }
    }
}
