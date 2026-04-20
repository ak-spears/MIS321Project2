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
                t.seller_id,
                t.buyer_confirmed_at,
                t.seller_confirmed_at,
                COALESCE(su.display_name, 'Seller') AS seller_display_name
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

    public async Task<ConfirmCompletionResult> ConfirmCompletionAsync(
        int transactionId,
        int actorUserId,
        CancellationToken cancellationToken = default)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var dbTx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            const string selectSql = """
                SELECT
                    t.transaction_id,
                    t.listing_id,
                    t.buyer_id,
                    t.seller_id,
                    t.amount,
                    t.platform_fee,
                    t.payment_method,
                    t.status,
                    t.created_at,
                    t.buyer_confirmed_at,
                    t.seller_confirmed_at,
                    COALESCE(l.title, '(listing unavailable)') AS title,
                    COALESCE(bu.display_name, '(buyer)') AS buyer_display_name,
                    COALESCE(su.display_name, 'Seller') AS seller_display_name
                FROM transactions t
                LEFT JOIN listings l ON l.listing_id = t.listing_id
                LEFT JOIN users bu ON bu.user_id = t.buyer_id
                LEFT JOIN users su ON su.user_id = t.seller_id
                WHERE t.transaction_id = @tid
                FOR UPDATE;
                """;

            int listingId;
            int buyerId;
            int sellerId;
            decimal amount;
            decimal platformFee;
            string paymentMethod;
            string status;
            DateTime createdAt;
            bool buyerConfirmed;
            bool sellerConfirmed;
            string title;
            string buyerDisplayName;
            string sellerDisplayName;

            await using (var selectCmd = new MySqlCommand(selectSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@tid", transactionId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return new ConfirmCompletionResult { Outcome = ConfirmCompletionOutcome.NotFound };
                }

                listingId = reader.GetInt32(reader.GetOrdinal("listing_id"));
                buyerId = reader.GetInt32(reader.GetOrdinal("buyer_id"));
                sellerId = reader.GetInt32(reader.GetOrdinal("seller_id"));
                amount = reader.GetDecimal(reader.GetOrdinal("amount"));
                platformFee = reader.GetDecimal(reader.GetOrdinal("platform_fee"));
                paymentMethod = reader.GetString(reader.GetOrdinal("payment_method"));
                status = reader.GetString(reader.GetOrdinal("status"));
                createdAt = reader.GetDateTime(reader.GetOrdinal("created_at"));
                buyerConfirmed = !reader.IsDBNull(reader.GetOrdinal("buyer_confirmed_at"));
                sellerConfirmed = !reader.IsDBNull(reader.GetOrdinal("seller_confirmed_at"));
                title = reader.GetString(reader.GetOrdinal("title"));
                buyerDisplayName = reader.GetString(reader.GetOrdinal("buyer_display_name"));
                sellerDisplayName = reader.GetString(reader.GetOrdinal("seller_display_name"));
                await reader.CloseAsync();
            }

            if (actorUserId != buyerId && actorUserId != sellerId)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return new ConfirmCompletionResult { Outcome = ConfirmCompletionOutcome.Forbidden };
            }

            if (string.Equals(status, "cancelled", StringComparison.OrdinalIgnoreCase))
            {
                await dbTx.RollbackAsync(cancellationToken);
                return new ConfirmCompletionResult { Outcome = ConfirmCompletionOutcome.Conflict };
            }

            if (actorUserId == buyerId && !buyerConfirmed)
            {
                await using var updateBuyer = new MySqlCommand(
                    "UPDATE transactions SET buyer_confirmed_at = UTC_TIMESTAMP() WHERE transaction_id = @tid;",
                    conn,
                    dbTx);
                updateBuyer.Parameters.AddWithValue("@tid", transactionId);
                await updateBuyer.ExecuteNonQueryAsync(cancellationToken);
                buyerConfirmed = true;
            }

            if (actorUserId == sellerId && !sellerConfirmed)
            {
                await using var updateSeller = new MySqlCommand(
                    "UPDATE transactions SET seller_confirmed_at = UTC_TIMESTAMP() WHERE transaction_id = @tid;",
                    conn,
                    dbTx);
                updateSeller.Parameters.AddWithValue("@tid", transactionId);
                await updateSeller.ExecuteNonQueryAsync(cancellationToken);
                sellerConfirmed = true;
            }

            if (buyerConfirmed && sellerConfirmed && !string.Equals(status, "completed", StringComparison.OrdinalIgnoreCase))
            {
                await using var updateStatus = new MySqlCommand(
                    "UPDATE transactions SET status = 'completed' WHERE transaction_id = @tid;",
                    conn,
                    dbTx);
                updateStatus.Parameters.AddWithValue("@tid", transactionId);
                await updateStatus.ExecuteNonQueryAsync(cancellationToken);
                status = "completed";
            }

            await dbTx.CommitAsync(cancellationToken);

            return new ConfirmCompletionResult
            {
                Outcome = ConfirmCompletionOutcome.Ok,
                Row = new TransactionListItemDto
                {
                    TransactionId = transactionId,
                    ListingId = listingId,
                    Title = title,
                    Amount = amount,
                    PlatformFee = platformFee,
                    PaymentMethod = paymentMethod,
                    Status = status,
                    CreatedAt = createdAt,
                    BuyerId = buyerId,
                    BuyerDisplayName = buyerDisplayName,
                    SellerId = sellerId,
                    SellerDisplayName = sellerDisplayName,
                    BuyerConfirmed = buyerConfirmed,
                    SellerConfirmed = sellerConfirmed,
                },
            };
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<MoveToDonationResult> MoveStaleSaleToDonationAsync(
        int transactionId,
        int actorUserId,
        int minInactiveDays = 15,
        CancellationToken cancellationToken = default)
    {
        if (minInactiveDays < 1)
        {
            minInactiveDays = 15;
        }

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var dbTx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            const string selectSql = """
                SELECT
                    t.transaction_id,
                    t.listing_id,
                    t.seller_id,
                    t.status,
                    t.created_at,
                    t.buyer_confirmed_at,
                    t.seller_confirmed_at
                FROM transactions t
                WHERE t.transaction_id = @tid
                FOR UPDATE;
                """;

            int listingId;
            int sellerId;
            string status;
            DateTime createdAt;
            bool buyerConfirmed;
            bool sellerConfirmed;

            await using (var selectCmd = new MySqlCommand(selectSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@tid", transactionId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return new MoveToDonationResult { Outcome = MoveToDonationOutcome.NotFound };
                }

                listingId = reader.GetInt32(reader.GetOrdinal("listing_id"));
                sellerId = reader.GetInt32(reader.GetOrdinal("seller_id"));
                status = reader.GetString(reader.GetOrdinal("status"));
                createdAt = reader.GetDateTime(reader.GetOrdinal("created_at"));
                buyerConfirmed = !reader.IsDBNull(reader.GetOrdinal("buyer_confirmed_at"));
                sellerConfirmed = !reader.IsDBNull(reader.GetOrdinal("seller_confirmed_at"));
                await reader.CloseAsync();
            }

            if (actorUserId != sellerId)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return new MoveToDonationResult { Outcome = MoveToDonationOutcome.Forbidden };
            }

            if (!string.Equals(status, "pending", StringComparison.OrdinalIgnoreCase) || buyerConfirmed || sellerConfirmed)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return new MoveToDonationResult { Outcome = MoveToDonationOutcome.Conflict };
            }

            var inactiveDays = (DateTime.UtcNow - createdAt.ToUniversalTime()).TotalDays;
            if (inactiveDays < minInactiveDays)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return new MoveToDonationResult { Outcome = MoveToDonationOutcome.Conflict };
            }

            await using (var cancelTxCmd = new MySqlCommand(
                             "UPDATE transactions SET status = 'cancelled', platform_fee = 0, fee_paid_at = UTC_TIMESTAMP() WHERE transaction_id = @tid AND status = 'pending';",
                             conn,
                             dbTx))
            {
                cancelTxCmd.Parameters.AddWithValue("@tid", transactionId);
                var n = await cancelTxCmd.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return new MoveToDonationResult { Outcome = MoveToDonationOutcome.Conflict };
                }
            }

            await using (var updateListingCmd = new MySqlCommand(
                             """
                             UPDATE listings
                             SET price = 0,
                                 or_best_offer = 0,
                                 status = 'active'
                             WHERE listing_id = @lid AND seller_id = @sid AND status <> 'removed';
                             """,
                             conn,
                             dbTx))
            {
                updateListingCmd.Parameters.AddWithValue("@lid", listingId);
                updateListingCmd.Parameters.AddWithValue("@sid", sellerId);
                var n = await updateListingCmd.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return new MoveToDonationResult { Outcome = MoveToDonationOutcome.Conflict };
                }
            }

            await dbTx.CommitAsync(cancellationToken);
            return new MoveToDonationResult
            {
                Outcome = MoveToDonationOutcome.Ok,
                ListingId = listingId,
                TransactionId = transactionId,
            };
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<CancelBySellerResult> CancelPendingBySellerAsync(
        int transactionId,
        int actorUserId,
        CancellationToken cancellationToken = default)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var dbTx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            const string selectSql = """
                SELECT transaction_id, listing_id, seller_id, status, buyer_confirmed_at, seller_confirmed_at
                FROM transactions
                WHERE transaction_id = @tid
                FOR UPDATE;
                """;

            int listingId;
            int sellerId;
            string status;
            bool buyerConfirmed;
            bool sellerConfirmed;

            await using (var selectCmd = new MySqlCommand(selectSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@tid", transactionId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return new CancelBySellerResult { Outcome = CancelBySellerOutcome.NotFound };
                }

                listingId = reader.GetInt32(reader.GetOrdinal("listing_id"));
                sellerId = reader.GetInt32(reader.GetOrdinal("seller_id"));
                status = reader.GetString(reader.GetOrdinal("status"));
                buyerConfirmed = !reader.IsDBNull(reader.GetOrdinal("buyer_confirmed_at"));
                sellerConfirmed = !reader.IsDBNull(reader.GetOrdinal("seller_confirmed_at"));
                await reader.CloseAsync();
            }

            if (actorUserId != sellerId)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return new CancelBySellerResult { Outcome = CancelBySellerOutcome.Forbidden };
            }

            if (!string.Equals(status, "pending", StringComparison.OrdinalIgnoreCase) || buyerConfirmed || sellerConfirmed)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return new CancelBySellerResult { Outcome = CancelBySellerOutcome.Conflict };
            }

            await using (var cancelCmd = new MySqlCommand(
                             "UPDATE transactions SET status = 'cancelled', platform_fee = 0, fee_paid_at = UTC_TIMESTAMP() WHERE transaction_id = @tid AND status = 'pending';",
                             conn,
                             dbTx))
            {
                cancelCmd.Parameters.AddWithValue("@tid", transactionId);
                var n = await cancelCmd.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return new CancelBySellerResult { Outcome = CancelBySellerOutcome.Conflict };
                }
            }

            await using (var listingCmd = new MySqlCommand(
                             """
                             UPDATE listings
                             SET status = 'active'
                             WHERE listing_id = @lid AND seller_id = @sid AND status = 'sold';
                             """,
                             conn,
                             dbTx))
            {
                listingCmd.Parameters.AddWithValue("@lid", listingId);
                listingCmd.Parameters.AddWithValue("@sid", sellerId);
                var n = await listingCmd.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return new CancelBySellerResult { Outcome = CancelBySellerOutcome.Conflict };
                }
            }

            await dbTx.CommitAsync(cancellationToken);
            return new CancelBySellerResult
            {
                Outcome = CancelBySellerOutcome.Ok,
                ListingId = listingId,
                TransactionId = transactionId,
            };
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    /// <summary>
    /// True when seller has more than <paramref name="thresholdUsd"/> in unpaid platform fees
    /// from completed transactions older than <paramref name="overdueDays"/>.
    /// </summary>
    public async Task<bool> HasOverdueUnpaidFeesAsync(
        int sellerId,
        decimal thresholdUsd = 25m,
        int overdueDays = 30,
        CancellationToken cancellationToken = default)
    {
        if (sellerId <= 0)
        {
            return false;
        }

        if (thresholdUsd <= 0m)
        {
            thresholdUsd = 25m;
        }

        if (overdueDays < 1)
        {
            overdueDays = 30;
        }

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        const string sql = """
            SELECT COALESCE(SUM(platform_fee), 0)
            FROM transactions
            WHERE seller_id = @sid
              AND status = 'completed'
              AND fee_paid_at IS NULL
              AND created_at <= UTC_TIMESTAMP() - INTERVAL @days DAY;
            """;
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@sid", sellerId);
        cmd.Parameters.AddWithValue("@days", overdueDays);

        try
        {
            var scalar = await cmd.ExecuteScalarAsync(cancellationToken);
            var total = scalar == null || scalar == DBNull.Value ? 0m : Convert.ToDecimal(scalar);
            return total > thresholdUsd;
        }
        catch (MySqlException ex) when (ex.Number == 1054)
        {
            // Older schema without fee_paid_at should not block posting.
            return false;
        }
    }
}
