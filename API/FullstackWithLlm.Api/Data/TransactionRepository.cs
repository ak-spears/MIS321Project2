using FullstackWithLlm.Api.Models;
using MySqlConnector;

namespace FullstackWithLlm.Api.Data;

public sealed class TransactionRepository
{
    private const decimal PlatformFeeRate = 0.07m;

    /// <summary>Block new/edited for-sale listings when total unpaid <c>platform_fee</c> (completed, not paid) is at or above this amount.</summary>
    public const decimal UnpaidFeeBalanceBlockListingsThresholdUsd = 25m;

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

    public enum CreateCheckoutError
    {
        None,
        Unavailable,
        InvalidOffer,
    }

    public readonly record struct CreateCheckoutResult(TransactionListItemDto? Row, CreateCheckoutError Error);

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
                t.buyer_id,
                t.seller_id,
                t.buyer_confirmed_at,
                t.seller_confirmed_at,
                COALESCE(
                    NULLIF(TRIM(SUBSTRING_INDEX(LOWER(TRIM(COALESCE(su.email, ''))), '@', 1)), ''),
                    CONCAT('User #', t.seller_id)
                ) AS seller_display_name,
                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM ratings r
                        WHERE r.listing_id = t.listing_id
                          AND r.rater_id = t.buyer_id
                          AND r.ratee_id = t.seller_id
                    ) THEN 1
                    ELSE 0
                END AS has_rating,
                COALESCE(l.price, 0) AS listing_list_price,
                COALESCE(l.or_best_offer, 0) AS listing_is_obo,
                COALESCE(t.obo_seller_ack, 0) AS obo_seller_ack
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
                BuyerId = reader.GetInt32(reader.GetOrdinal("buyer_id")),
                SellerId = reader.GetInt32(reader.GetOrdinal("seller_id")),
                SellerDisplayName = reader.IsDBNull(reader.GetOrdinal("seller_display_name"))
                    ? null
                    : reader.GetString(reader.GetOrdinal("seller_display_name")),
                BuyerConfirmed = !reader.IsDBNull(reader.GetOrdinal("buyer_confirmed_at")),
                SellerConfirmed = !reader.IsDBNull(reader.GetOrdinal("seller_confirmed_at")),
                ListingListPrice = reader.GetDecimal(reader.GetOrdinal("listing_list_price")),
                ListingOrBestOffer = !reader.IsDBNull(reader.GetOrdinal("listing_is_obo"))
                    && reader.GetInt32(reader.GetOrdinal("listing_is_obo")) == 1,
                OboSellerAcknowledged = !reader.IsDBNull(reader.GetOrdinal("obo_seller_ack"))
                    && reader.GetInt32(reader.GetOrdinal("obo_seller_ack")) == 1,
            });
        }

        return list;
    }

    /// <summary>Seller in-box: pending (claimed) sales only. Does not use <c>users.display_name</c> (email fallback).</summary>
    public async Task<IReadOnlyList<SellerSaleListItemDto>> GetSellingInProgressForSellerAsync(
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
                COALESCE(
                    NULLIF(TRIM(SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1)), ''),
                    CONCAT('User #', t.buyer_id)
                ) AS buyer_display_name,
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
            });
        }

        return list;
    }

    /// <summary>Seller&apos;s all sales (newest first) for <c>GET /api/transactions/sales</c>. Email fallback for buyer name.</summary>
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
                COALESCE(
                    NULLIF(TRIM(SUBSTRING_INDEX(LOWER(TRIM(COALESCE(b.email, ''))), '@', 1)), ''),
                    '(buyer)'
                ) AS buyer_display_name,
                COALESCE(l.price, 0) AS listing_list_price,
                COALESCE(l.or_best_offer, 0) AS listing_is_obo,
                COALESCE(t.obo_seller_ack, 0) AS obo_seller_ack
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
                HasRating = false,
                CreatedAt = reader.GetDateTime(reader.GetOrdinal("created_at")),
                SellerId = reader.GetInt32(reader.GetOrdinal("seller_id")),
                BuyerId = reader.GetInt32(reader.GetOrdinal("buyer_id")),
                BuyerDisplayName = reader.GetString(reader.GetOrdinal("buyer_display_name")),
                SellerDisplayName = null,
                BuyerConfirmed = !reader.IsDBNull(reader.GetOrdinal("buyer_confirmed_at")),
                SellerConfirmed = !reader.IsDBNull(reader.GetOrdinal("seller_confirmed_at")),
                ListingListPrice = reader.GetDecimal(reader.GetOrdinal("listing_list_price")),
                ListingOrBestOffer = !reader.IsDBNull(reader.GetOrdinal("listing_is_obo"))
                    && reader.GetInt32(reader.GetOrdinal("listing_is_obo")) == 1,
                OboSellerAcknowledged = !reader.IsDBNull(reader.GetOrdinal("obo_seller_ack"))
                    && reader.GetInt32(reader.GetOrdinal("obo_seller_ack")) == 1,
            });
        }

        return list;
    }

    /// <summary>
    /// Claims (reserves) a listing and creates a pending transaction row.
    /// Payment is not captured here; completion happens when the buyer marks the item received.
    /// </summary>
    public async Task<CreateCheckoutResult> CreateCheckoutAsync(
        int buyerId,
        int listingId,
        string paymentMethod,
        decimal? offeredAmount = null,
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
                SELECT seller_id, price, status, title, or_best_offer
                FROM listings
                WHERE listing_id = @lid
                FOR UPDATE;
                """;

            int sellerId;
            decimal listPrice;
            string status;
            string listingTitle;
            bool orBestOffer;

            await using (var selectCmd = new MySqlCommand(selectSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@lid", listingId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return new CreateCheckoutResult(null, CreateCheckoutError.Unavailable);
                }

                var ordObo = reader.GetOrdinal("or_best_offer");
                orBestOffer = !reader.IsDBNull(ordObo) && Convert.ToBoolean(reader.GetValue(ordObo));
                sellerId = reader.GetInt32(reader.GetOrdinal("seller_id"));
                listPrice = reader.GetDecimal(reader.GetOrdinal("price"));
                status = reader.GetString(reader.GetOrdinal("status"));
                listingTitle = reader.GetString(reader.GetOrdinal("title"));
                await reader.CloseAsync();
            }

            if (!string.Equals(status, "active", StringComparison.OrdinalIgnoreCase))
            {
                await dbTx.RollbackAsync(cancellationToken);
                return new CreateCheckoutResult(null, CreateCheckoutError.Unavailable);
            }

            if (sellerId == buyerId)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return new CreateCheckoutResult(null, CreateCheckoutError.Unavailable);
            }

            var chargeAmount = listPrice;
            if (orBestOffer && listPrice > 0m)
            {
                if (offeredAmount.HasValue)
                {
                    var o = Math.Round(offeredAmount.Value, 2, MidpointRounding.AwayFromZero);
                    if (o <= 0m || o > listPrice)
                    {
                        await dbTx.RollbackAsync(cancellationToken);
                        return new CreateCheckoutResult(null, CreateCheckoutError.InvalidOffer);
                    }

                    chargeAmount = o;
                }
            }
            else
            {
                // Not OBO: list price (ignore offeredAmount for paid; free uses 0 from list)
                chargeAmount = listPrice;
            }

            var platformFee = chargeAmount > 0m
                ? Math.Round(chargeAmount * PlatformFeeRate, 2, MidpointRounding.AwayFromZero)
                : 0m;

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
                insertCmd.Parameters.AddWithValue("@amount", chargeAmount);
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
                return new CreateCheckoutResult(null, CreateCheckoutError.Unavailable);
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
                    return new CreateCheckoutResult(null, CreateCheckoutError.Unavailable);
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

            return new CreateCheckoutResult(
                new TransactionListItemDto
                {
                    TransactionId = newId,
                    ListingId = listingId,
                    Title = listingTitle,
                    Amount = chargeAmount,
                    PlatformFee = platformFee,
                    PaymentMethod = paymentMethod,
                    Status = "pending",
                    HasRating = false,
                    CreatedAt = createdAtRow,
                    SellerId = sellerId,
                    BuyerId = buyerId,
                    BuyerConfirmed = false,
                    SellerConfirmed = false,
                    ListingListPrice = listPrice,
                    ListingOrBestOffer = orBestOffer,
                    OboSellerAcknowledged = false,
                },
                CreateCheckoutError.None);
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
                    t.buyer_confirmed_at,
                    t.seller_confirmed_at,
                    COALESCE(l.title, '(listing unavailable)') AS title,
                    COALESCE(l.status, '') AS listing_status,
                    COALESCE(l.price, 0) AS listing_list_price,
                    COALESCE(l.or_best_offer, 0) AS listing_is_obo,
                    COALESCE(t.obo_seller_ack, 0) AS obo_seller_ack
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
            var hasBothConfirmations = false;
            decimal listingListPriceO = 0m;
            var listingOrBestOfferO = false;
            var oboSellerAcknowledgedO = false;

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
                var bOrd = reader.GetOrdinal("buyer_confirmed_at");
                var sOrd = reader.GetOrdinal("seller_confirmed_at");
                hasBothConfirmations = !reader.IsDBNull(bOrd) && !reader.IsDBNull(sOrd);
                listingListPriceO = reader.GetDecimal(reader.GetOrdinal("listing_list_price"));
                var oOrd = reader.GetOrdinal("listing_is_obo");
                listingOrBestOfferO = !reader.IsDBNull(oOrd) && reader.GetInt32(oOrd) == 1;
                var aOrd = reader.GetOrdinal("obo_seller_ack");
                oboSellerAcknowledgedO = !reader.IsDBNull(aOrd) && reader.GetInt32(aOrd) == 1;
                await reader.CloseAsync();
            }

            if (!hasBothConfirmations)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
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
                SET
                    status = 'completed',
                    completed_at = COALESCE(completed_at, UTC_TIMESTAMP(3))
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
                ListingListPrice = listingListPriceO,
                ListingOrBestOffer = listingOrBestOfferO,
                OboSellerAcknowledged = oboSellerAcknowledgedO,
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
                    COALESCE(l.status, '') AS listing_status,
                    COALESCE(l.price, 0) AS listing_list_price,
                    COALESCE(l.or_best_offer, 0) AS listing_is_obo,
                    COALESCE(t.obo_seller_ack, 0) AS obo_seller_ack
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
            decimal listingListPriceR = 0m;
            var listingOrBestOfferR = false;
            var oboSellerAcknowledgedR = false;

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
                listingListPriceR = reader.GetDecimal(reader.GetOrdinal("listing_list_price"));
                var oOrd = reader.GetOrdinal("listing_is_obo");
                listingOrBestOfferR = !reader.IsDBNull(oOrd) && reader.GetInt32(oOrd) == 1;
                var aOrd = reader.GetOrdinal("obo_seller_ack");
                oboSellerAcknowledgedR = !reader.IsDBNull(aOrd) && reader.GetInt32(aOrd) == 1;
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
                ListingListPrice = listingListPriceR,
                ListingOrBestOffer = listingOrBestOfferR,
                OboSellerAcknowledged = oboSellerAcknowledgedR,
            };
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    /// <summary>Buyer or seller sets their handoff/pickup confirmation (idempotent if already set).</summary>
    public async Task<TransactionListItemDto?> ConfirmHandoffAsync(
        int userId,
        int transactionId,
        CancellationToken cancellationToken = default)
    {
        if (transactionId <= 0 || userId <= 0)
        {
            return null;
        }

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var dbTx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            const string selectSql = """
                SELECT t.buyer_id, t.seller_id, t.status
                FROM transactions t
                WHERE t.transaction_id = @tid
                FOR UPDATE;
                """;

            int buyerId;
            int sellerId;
            string status = "";

            await using (var selectCmd = new MySqlCommand(selectSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@tid", transactionId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }

                buyerId = reader.GetInt32(reader.GetOrdinal("buyer_id"));
                sellerId = reader.GetInt32(reader.GetOrdinal("seller_id"));
                status = reader.GetString(reader.GetOrdinal("status"));
                await reader.CloseAsync();
            }

            if (!string.Equals(status, "pending", StringComparison.OrdinalIgnoreCase))
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            if (userId == buyerId)
            {
                const string upd = """
                    UPDATE transactions
                    SET buyer_confirmed_at = COALESCE(buyer_confirmed_at, UTC_TIMESTAMP(3))
                    WHERE transaction_id = @tid AND buyer_id = @uid AND status = 'pending';
                    """;
                await using var cmd = new MySqlCommand(upd, conn, dbTx);
                cmd.Parameters.AddWithValue("@tid", transactionId);
                cmd.Parameters.AddWithValue("@uid", userId);
                var n = await cmd.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }
            }
            else if (userId == sellerId)
            {
                const string upd = """
                    UPDATE transactions
                    SET seller_confirmed_at = COALESCE(seller_confirmed_at, UTC_TIMESTAMP(3))
                    WHERE transaction_id = @tid AND seller_id = @uid AND status = 'pending';
                    """;
                await using var cmd = new MySqlCommand(upd, conn, dbTx);
                cmd.Parameters.AddWithValue("@tid", transactionId);
                cmd.Parameters.AddWithValue("@uid", userId);
                var n = await cmd.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }
            }
            else
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            await dbTx.CommitAsync(cancellationToken);
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }

        return await ReadTransactionListItemForParticipantAsync(userId, transactionId, cancellationToken);
    }

    /// <summary>
    /// Seller cancels a stale <strong>paid</strong> sale, relists the item as a free donation (price 0) after inactivity.
    /// </summary>
    public async Task<MoveToDonationResult> MoveTransactionToDonationsAsync(
        int sellerId,
        int transactionId,
        CancellationToken cancellationToken = default)
    {
        if (transactionId <= 0 || sellerId <= 0)
        {
            return new MoveToDonationResult
            {
                Outcome = MoveToDonationOutcome.NotFound,
                TransactionId = transactionId,
                ListingId = 0,
            };
        }

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var dbTx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            const string selectSql = """
                SELECT
                    t.listing_id,
                    t.amount,
                    t.status
                FROM transactions t
                INNER JOIN listings l ON l.listing_id = t.listing_id
                WHERE t.transaction_id = @tid
                  AND t.seller_id = @sid
                  AND t.status = 'pending'
                  AND t.amount > 0
                  AND l.status = 'claimed'
                  AND TIMESTAMPDIFF(DAY, COALESCE(t.claimed_at, t.created_at), UTC_TIMESTAMP()) >= 15
                FOR UPDATE;
                """;

            int listingId;
            await using (var selectCmd = new MySqlCommand(selectSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@tid", transactionId);
                selectCmd.Parameters.AddWithValue("@sid", sellerId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return new MoveToDonationResult
                    {
                        Outcome = MoveToDonationOutcome.Conflict,
                        TransactionId = transactionId,
                        ListingId = 0,
                    };
                }

                listingId = reader.GetInt32(reader.GetOrdinal("listing_id"));
                await reader.CloseAsync();
            }

            const string cancelTx = """
                UPDATE transactions
                SET status = 'cancelled'
                WHERE transaction_id = @tid AND seller_id = @sid AND status = 'pending';
                """;

            await using (var ccmd = new MySqlCommand(cancelTx, conn, dbTx))
            {
                ccmd.Parameters.AddWithValue("@tid", transactionId);
                ccmd.Parameters.AddWithValue("@sid", sellerId);
                var n = await ccmd.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return new MoveToDonationResult
                    {
                        Outcome = MoveToDonationOutcome.Conflict,
                        TransactionId = transactionId,
                        ListingId = listingId,
                    };
                }
            }

            const string relist = """
                UPDATE listings
                SET status = 'active', price = 0.00
                WHERE listing_id = @lid AND seller_id = @sid;
                """;

            await using (var lcmd = new MySqlCommand(relist, conn, dbTx))
            {
                lcmd.Parameters.AddWithValue("@lid", listingId);
                lcmd.Parameters.AddWithValue("@sid", sellerId);
                var n = await lcmd.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return new MoveToDonationResult
                    {
                        Outcome = MoveToDonationOutcome.Conflict,
                        TransactionId = transactionId,
                        ListingId = listingId,
                    };
                }
            }

            await dbTx.CommitAsync(cancellationToken);
            return new MoveToDonationResult
            {
                Outcome = MoveToDonationOutcome.Ok,
                TransactionId = transactionId,
                ListingId = listingId,
            };
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    /// <summary>
    /// Seller cancels a <strong>pending</strong> sale: transaction → cancelled, listing claimed → active (back on feed).
    /// Sets <c>platform_fee</c> to 0 on the row. Unpaid fee totals only sum <c>completed</c> sales; this makes the cancelled row clear.
    /// Cash/Venmo happens off-app — any real refund is between buyer and seller.
    /// </summary>
    public async Task<TransactionListItemDto?> CancelBySellerAsync(
        int sellerId,
        int transactionId,
        CancellationToken cancellationToken = default)
    {
        if (transactionId <= 0 || sellerId <= 0)
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
                    COALESCE(l.status, '') AS listing_status,
                    COALESCE(l.price, 0) AS listing_list_price,
                    COALESCE(l.or_best_offer, 0) AS listing_is_obo,
                    COALESCE(t.obo_seller_ack, 0) AS obo_seller_ack
                FROM transactions t
                LEFT JOIN listings l ON l.listing_id = t.listing_id
                WHERE t.transaction_id = @tid AND t.seller_id = @sid
                FOR UPDATE;
                """;

            int listingId;
            string status;
            string title;
            string listingStatus;
            decimal amount;
            string paymentMethod;
            DateTime createdAt;
            decimal listingListPriceC = 0m;
            var listingOrBestOfferC = false;
            var oboSellerAcknowledgedC = false;

            await using (var selectCmd = new MySqlCommand(selectTxSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@tid", transactionId);
                selectCmd.Parameters.AddWithValue("@sid", sellerId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }

                listingId = reader.GetInt32(reader.GetOrdinal("listing_id"));
                amount = reader.GetDecimal(reader.GetOrdinal("amount"));
                _ = reader.GetDecimal(reader.GetOrdinal("platform_fee"));
                paymentMethod = reader.GetString(reader.GetOrdinal("payment_method"));
                status = reader.GetString(reader.GetOrdinal("status"));
                createdAt = reader.GetDateTime(reader.GetOrdinal("created_at"));
                title = reader.GetString(reader.GetOrdinal("title"));
                listingStatus = reader.GetString(reader.GetOrdinal("listing_status"));
                listingListPriceC = reader.GetDecimal(reader.GetOrdinal("listing_list_price"));
                var oOrd = reader.GetOrdinal("listing_is_obo");
                listingOrBestOfferC = !reader.IsDBNull(oOrd) && reader.GetInt32(oOrd) == 1;
                var aOrd = reader.GetOrdinal("obo_seller_ack");
                oboSellerAcknowledgedC = !reader.IsDBNull(aOrd) && reader.GetInt32(aOrd) == 1;
                await reader.CloseAsync();
            }

            if (!string.Equals(status, "pending", StringComparison.OrdinalIgnoreCase))
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            var listingStatusNorm = (listingStatus ?? "").Trim().ToLowerInvariant();
            if (string.Equals(listingStatusNorm, "claimed", StringComparison.OrdinalIgnoreCase))
            {
                const string updateListingSql = """
                    UPDATE listings
                    SET status = 'active'
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
            }
            else if (string.Equals(listingStatusNorm, "active", StringComparison.OrdinalIgnoreCase)
                     || string.IsNullOrWhiteSpace(listingStatusNorm))
            {
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
                SET
                    status = 'cancelled',
                    platform_fee = 0.00
                WHERE transaction_id = @tid AND seller_id = @sid AND status = 'pending';
                """;

            await using (var updateTx = new MySqlCommand(updateTxSql, conn, dbTx))
            {
                updateTx.Parameters.AddWithValue("@tid", transactionId);
                updateTx.Parameters.AddWithValue("@sid", sellerId);
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
                PlatformFee = 0m,
                PaymentMethod = paymentMethod,
                Status = "cancelled",
                CreatedAt = createdAt,
                ListingListPrice = listingListPriceC,
                ListingOrBestOffer = listingOrBestOfferC,
                OboSellerAcknowledged = oboSellerAcknowledgedC,
            };
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    /// <summary>
    /// Seller confirms they accept the below-list Or Best Offer price on a pending OBO sale (recorded in <c>obo_seller_ack</c>).
    /// </summary>
    public async Task<TransactionListItemDto?> TryAcknowledgeOrBestOfferAsync(
        int sellerId,
        int transactionId,
        CancellationToken cancellationToken = default)
    {
        if (transactionId <= 0 || sellerId <= 0)
        {
            return null;
        }

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var dbTx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            const string selectSql = """
                SELECT
                    t.status,
                    COALESCE(t.obo_seller_ack, 0) AS obo_seller_ack,
                    COALESCE(l.or_best_offer, 0) AS l_obo,
                    COALESCE(l.price, 0) AS list_price,
                    t.amount
                FROM transactions t
                LEFT JOIN listings l ON l.listing_id = t.listing_id
                WHERE t.transaction_id = @tid AND t.seller_id = @sid
                FOR UPDATE;
                """;

            string status;
            var oboAck = false;
            var lObo = false;
            decimal listPrice;
            decimal amount;

            await using (var selectCmd = new MySqlCommand(selectSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@tid", transactionId);
                selectCmd.Parameters.AddWithValue("@sid", sellerId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }

                status = reader.GetString(reader.GetOrdinal("status"));
                var aOrd = reader.GetOrdinal("obo_seller_ack");
                oboAck = !reader.IsDBNull(aOrd) && reader.GetInt32(aOrd) == 1;
                var oOrd = reader.GetOrdinal("l_obo");
                lObo = !reader.IsDBNull(oOrd) && reader.GetInt32(oOrd) == 1;
                listPrice = reader.GetDecimal(reader.GetOrdinal("list_price"));
                amount = reader.GetDecimal(reader.GetOrdinal("amount"));
                await reader.CloseAsync();
            }

            if (!string.Equals(status, "pending", StringComparison.OrdinalIgnoreCase))
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            if (!lObo || listPrice <= 0m)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            if (amount >= listPrice)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            if (oboAck)
            {
                await dbTx.CommitAsync(cancellationToken);
                return await ReadTransactionListItemForParticipantAsync(sellerId, transactionId, cancellationToken);
            }

            const string updateSql = """
                UPDATE transactions t
                INNER JOIN listings l ON l.listing_id = t.listing_id
                SET t.obo_seller_ack = 1
                WHERE t.transaction_id = @tid
                  AND t.seller_id = @sid
                  AND t.status = 'pending'
                  AND COALESCE(l.or_best_offer, 0) = 1
                  AND t.amount < l.price
                  AND COALESCE(t.obo_seller_ack, 0) = 0
                """;

            await using (var upd = new MySqlCommand(updateSql, conn, dbTx))
            {
                upd.Parameters.AddWithValue("@tid", transactionId);
                upd.Parameters.AddWithValue("@sid", sellerId);
                var n = await upd.ExecuteNonQueryAsync(cancellationToken);
                if (n != 1)
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }
            }

            await dbTx.CommitAsync(cancellationToken);
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }

        return await ReadTransactionListItemForParticipantAsync(sellerId, transactionId, cancellationToken);
    }

    private async Task<TransactionListItemDto?> ReadTransactionListItemForParticipantAsync(
        int userId,
        int transactionId,
        CancellationToken cancellationToken)
    {
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
                t.buyer_id,
                t.seller_id,
                t.buyer_confirmed_at,
                t.seller_confirmed_at,
                COALESCE(
                    NULLIF(TRIM(SUBSTRING_INDEX(LOWER(TRIM(COALESCE(su.email, ''))), '@', 1)), ''),
                    CONCAT('User #', t.seller_id)
                ) AS seller_display_name,
                COALESCE(
                    NULLIF(TRIM(SUBSTRING_INDEX(LOWER(TRIM(COALESCE(bu.email, ''))), '@', 1)), ''),
                    CONCAT('User #', t.buyer_id)
                ) AS buyer_display_name,
                CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM ratings r
                        WHERE r.listing_id = t.listing_id
                          AND r.rater_id = t.buyer_id
                          AND r.ratee_id = t.seller_id
                    ) THEN 1
                    ELSE 0
                END AS has_rating,
                COALESCE(l.price, 0) AS listing_list_price,
                COALESCE(l.or_best_offer, 0) AS listing_is_obo,
                COALESCE(t.obo_seller_ack, 0) AS obo_seller_ack
            FROM transactions t
            LEFT JOIN listings l ON l.listing_id = t.listing_id
            LEFT JOIN users su ON su.user_id = t.seller_id
            LEFT JOIN users bu ON bu.user_id = t.buyer_id
            WHERE t.transaction_id = @tid
              AND (t.buyer_id = @uid OR t.seller_id = @uid);
            """;

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@tid", transactionId);
        cmd.Parameters.AddWithValue("@uid", userId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new TransactionListItemDto
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
            BuyerId = reader.GetInt32(reader.GetOrdinal("buyer_id")),
            SellerId = reader.GetInt32(reader.GetOrdinal("seller_id")),
            SellerDisplayName = reader.IsDBNull(reader.GetOrdinal("seller_display_name"))
                ? null
                : reader.GetString(reader.GetOrdinal("seller_display_name")),
            BuyerDisplayName = reader.IsDBNull(reader.GetOrdinal("buyer_display_name"))
                ? null
                : reader.GetString(reader.GetOrdinal("buyer_display_name")),
            BuyerConfirmed = !reader.IsDBNull(reader.GetOrdinal("buyer_confirmed_at")),
            SellerConfirmed = !reader.IsDBNull(reader.GetOrdinal("seller_confirmed_at")),
            ListingListPrice = reader.GetDecimal(reader.GetOrdinal("listing_list_price")),
            ListingOrBestOffer = !reader.IsDBNull(reader.GetOrdinal("listing_is_obo"))
                && reader.GetInt32(reader.GetOrdinal("listing_is_obo")) == 1,
            OboSellerAcknowledged = !reader.IsDBNull(reader.GetOrdinal("obo_seller_ack"))
                && reader.GetInt32(reader.GetOrdinal("obo_seller_ack")) == 1,
        };
    }

    /// <summary>Total platform fees the seller still owes (completed sales, <c>fee_paid_at</c> not set).</summary>
    public async Task<decimal> GetUnpaidPlatformFeesTotalAsync(int sellerId, CancellationToken cancellationToken = default)
    {
        if (sellerId <= 0)
        {
            return 0m;
        }

        const string sql = """
            SELECT COALESCE(SUM(t.platform_fee), 0) AS s
            FROM transactions t
            WHERE t.seller_id = @sid
              AND t.status = 'completed'
              AND t.fee_paid_at IS NULL;
            """;

        try
        {
            await using var conn = new MySqlConnection(_connectionString);
            await conn.OpenAsync(cancellationToken);
            await using var cmd = new MySqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@sid", sellerId);
            var scalar = await cmd.ExecuteScalarAsync(cancellationToken);
            return scalar is null or DBNull ? 0m : Convert.ToDecimal(scalar);
        }
        catch (MySqlException)
        {
            return 0m;
        }
    }

    /// <summary>
    /// True when the seller’s unpaid completed fees exceed <paramref name="minDollarAmount"/> and are older than <paramref name="minDaysOld"/> days
    /// (used to gate new listings). Returns false if <c>fee_paid_at</c> / <c>completed_at</c> are missing on the server schema.
    /// </summary>
    public async Task<bool> HasOverdueUnpaidFeesAsync(
        int sellerId,
        decimal minDollarAmount,
        int minDaysOld,
        CancellationToken cancellationToken = default)
    {
        if (sellerId <= 0 || minDollarAmount <= 0 || minDaysOld < 0)
        {
            return false;
        }

        const string sql = """
            SELECT COALESCE(SUM(t.platform_fee), 0) AS s
            FROM transactions t
            WHERE t.seller_id = @sid
              AND t.status = 'completed'
              AND t.fee_paid_at IS NULL
              AND t.completed_at IS NOT NULL
              AND t.completed_at < (UTC_TIMESTAMP() - INTERVAL @days DAY);
            """;

        try
        {
            await using var conn = new MySqlConnection(_connectionString);
            await conn.OpenAsync(cancellationToken);
            await using var cmd = new MySqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@sid", sellerId);
            cmd.Parameters.AddWithValue("@days", minDaysOld);
            var scalar = await cmd.ExecuteScalarAsync(cancellationToken);
            var sum = scalar is null || scalar is DBNull ? 0m : Convert.ToDecimal(scalar);
            return sum >= minDollarAmount;
        }
        catch (MySqlException)
        {
            return false;
        }
    }
}
