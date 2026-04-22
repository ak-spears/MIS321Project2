using FullstackWithLlm.Api.Models;
using MySqlConnector;

namespace FullstackWithLlm.Api.Data;

public sealed class RatingRepository
{
    private readonly string _connectionString;

    public RatingRepository(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection") ?? "";
    }

    public async Task<RatingSummaryDto> GetSummaryForUserAsync(int rateeId, CancellationToken cancellationToken = default)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        // Prefer ignoring flagged reviews when column exists.
        const string sqlWithFlag = """
            SELECT AVG(r.score) AS avg_score, COUNT(*) AS c
            FROM ratings r
            WHERE r.ratee_id = @uid
              AND COALESCE(r.is_flagged, 0) = 0;
            """;

        const string sqlNoFlag = """
            SELECT AVG(r.score) AS avg_score, COUNT(*) AS c
            FROM ratings r
            WHERE r.ratee_id = @uid;
            """;

        async Task<RatingSummaryDto> ReadAsync(string sql)
        {
            await using var cmd = new MySqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@uid", rateeId);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return new RatingSummaryDto { AverageScore = 0, RatingCount = 0 };
            }

            var avg = reader.IsDBNull(0) ? 0 : reader.GetDecimal(0);
            var c = reader.IsDBNull(1) ? 0 : reader.GetInt32(1);
            return new RatingSummaryDto { AverageScore = avg, RatingCount = c };
        }

        try
        {
            return await ReadAsync(sqlWithFlag);
        }
        catch (MySqlException mx) when (mx.Number == 1054)
        {
            return await ReadAsync(sqlNoFlag);
        }
    }

    public async Task<IReadOnlyList<UserRatingDto>> GetRecentForUserAsync(
        int rateeId,
        int limit = 20,
        CancellationToken cancellationToken = default)
    {
        if (limit < 1) limit = 20;
        if (limit > 100) limit = 100;

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        const string sqlWithFlag = """
            SELECT
                r.rating_id,
                r.listing_id,
                r.rater_id,
                SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1) AS rater_display_name,
                r.ratee_id,
                r.score,
                r.comment,
                COALESCE(r.is_flagged, 0) AS is_flagged,
                COALESCE(r.is_harsh, 0) AS is_harsh,
                r.created_at
            FROM ratings r
            INNER JOIN users u ON u.user_id = r.rater_id
            WHERE r.ratee_id = @uid
              AND COALESCE(r.is_flagged, 0) = 0
            ORDER BY r.created_at DESC
            LIMIT @limit;
            """;

        const string sqlNoFlag = """
            SELECT
                r.rating_id,
                r.listing_id,
                r.rater_id,
                SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1) AS rater_display_name,
                r.ratee_id,
                r.score,
                r.comment,
                0 AS is_flagged,
                0 AS is_harsh,
                r.created_at
            FROM ratings r
            INNER JOIN users u ON u.user_id = r.rater_id
            WHERE r.ratee_id = @uid
            ORDER BY r.created_at DESC
            LIMIT @limit;
            """;

        async Task<IReadOnlyList<UserRatingDto>> ReadAsync(string sql)
        {
            await using var cmd = new MySqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@uid", rateeId);
            cmd.Parameters.AddWithValue("@limit", limit);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

            var rows = new List<UserRatingDto>();
            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(new UserRatingDto
                {
                    RatingId = reader.GetInt32(0),
                    ListingId = reader.GetInt32(1),
                    RaterId = reader.GetInt32(2),
                    RaterDisplayName = reader.IsDBNull(3) ? "" : reader.GetString(3),
                    RateeId = reader.GetInt32(4),
                    Score = reader.GetByte(5),
                    Comment = reader.IsDBNull(6) ? null : reader.GetString(6),
                    IsFlagged = !reader.IsDBNull(7) && reader.GetInt32(7) == 1,
                    IsHarsh = !reader.IsDBNull(8) && reader.GetInt32(8) == 1,
                    CreatedAt = reader.IsDBNull(9) ? null : reader.GetDateTime(9),
                });
            }

            return rows;
        }

        try
        {
            return await ReadAsync(sqlWithFlag);
        }
        catch (MySqlException mx) when (mx.Number == 1054)
        {
            return await ReadAsync(sqlNoFlag);
        }
    }

    /// <summary>Public reviews left for a specific listing (buyer → seller).</summary>
    public async Task<IReadOnlyList<UserRatingDto>> GetForListingAsync(
        int listingId,
        CancellationToken cancellationToken = default)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        const string sqlWithFlag = """
            SELECT
                r.rating_id,
                r.listing_id,
                r.rater_id,
                SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1) AS rater_display_name,
                r.ratee_id,
                r.score,
                r.comment,
                COALESCE(r.is_flagged, 0) AS is_flagged,
                COALESCE(r.is_harsh, 0) AS is_harsh,
                NULLIF(r.created_at, '0000-00-00 00:00:00') AS created_at
            FROM ratings r
            INNER JOIN users u ON u.user_id = r.rater_id
            WHERE r.listing_id = @lid
              AND COALESCE(r.is_flagged, 0) = 0
            ORDER BY r.created_at ASC;
            """;

        const string sqlNoFlag = """
            SELECT
                r.rating_id,
                r.listing_id,
                r.rater_id,
                SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1) AS rater_display_name,
                r.ratee_id,
                r.score,
                r.comment,
                0 AS is_flagged,
                0 AS is_harsh,
                NULLIF(r.created_at, '0000-00-00 00:00:00') AS created_at
            FROM ratings r
            INNER JOIN users u ON u.user_id = r.rater_id
            WHERE r.listing_id = @lid
            ORDER BY r.created_at ASC;
            """;

        async Task<IReadOnlyList<UserRatingDto>> ReadAsync(string sql)
        {
            await using var cmd = new MySqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@lid", listingId);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            var rows = new List<UserRatingDto>();
            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(new UserRatingDto
                {
                    RatingId = reader.GetInt32(0),
                    ListingId = reader.GetInt32(1),
                    RaterId = reader.GetInt32(2),
                    RaterDisplayName = reader.IsDBNull(3) ? "" : reader.GetString(3),
                    RateeId = reader.GetInt32(4),
                    Score = reader.GetByte(5),
                    Comment = reader.IsDBNull(6) ? null : reader.GetString(6),
                    IsFlagged = !reader.IsDBNull(7) && reader.GetInt32(7) == 1,
                    IsHarsh = !reader.IsDBNull(8) && reader.GetInt32(8) == 1,
                    CreatedAt = reader.IsDBNull(9) ? null : reader.GetDateTime(9),
                });
            }

            return rows;
        }

        try
        {
            return await ReadAsync(sqlWithFlag);
        }
        catch (MySqlException mx) when (mx.Number == 1054)
        {
            return await ReadAsync(sqlNoFlag);
        }
    }

    /// <summary>
    /// Creates a rating tied to a completed transaction (buyer → seller).
    /// Returns null if transaction not completed/not owned, or already rated (unique key).
    /// Also syncs denormalized columns on users (avg_rating, rating_count) when present.
    /// </summary>
    public async Task<UserRatingDto?> CreateForCompletedTransactionAsync(
        int buyerId,
        int transactionId,
        byte score,
        string? comment,
        CancellationToken cancellationToken = default)
    {
        if (buyerId <= 0 || transactionId <= 0)
        {
            return null;
        }

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var dbTx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            const string selectTxSql = """
                SELECT transaction_id, listing_id, buyer_id, seller_id, status
                FROM transactions
                WHERE transaction_id = @tid
                FOR UPDATE;
                """;

            int listingId;
            int sellerId;
            string status;
            int buyerRow;

            await using (var selectCmd = new MySqlCommand(selectTxSql, conn, dbTx))
            {
                selectCmd.Parameters.AddWithValue("@tid", transactionId);
                await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await dbTx.RollbackAsync(cancellationToken);
                    return null;
                }

                listingId = reader.GetInt32(reader.GetOrdinal("listing_id"));
                buyerRow = reader.GetInt32(reader.GetOrdinal("buyer_id"));
                sellerId = reader.GetInt32(reader.GetOrdinal("seller_id"));
                status = reader.GetString(reader.GetOrdinal("status"));
                await reader.CloseAsync();
            }

            if (buyerRow != buyerId || !string.Equals(status, "completed", StringComparison.OrdinalIgnoreCase))
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            const string insertSql = """
                INSERT INTO ratings (listing_id, rater_id, ratee_id, score, comment)
                VALUES (@lid, @rater, @ratee, @score, @comment);
                """;

            int ratingId;
            try
            {
                await using (var insertCmd = new MySqlCommand(insertSql, conn, dbTx))
                {
                    insertCmd.Parameters.AddWithValue("@lid", listingId);
                    insertCmd.Parameters.AddWithValue("@rater", buyerId);
                    insertCmd.Parameters.AddWithValue("@ratee", sellerId);
                    insertCmd.Parameters.AddWithValue("@score", score);
                    insertCmd.Parameters.AddWithValue("@comment", comment);
                    await insertCmd.ExecuteNonQueryAsync(cancellationToken);
                }
            }
            catch (MySqlException mx) when (mx.Number == 1062)
            {
                await dbTx.RollbackAsync(cancellationToken);
                return null;
            }

            await using (var idCmd = new MySqlCommand("SELECT LAST_INSERT_ID();", conn, dbTx))
            {
                var scalar = await idCmd.ExecuteScalarAsync(cancellationToken);
                ratingId = Convert.ToInt32(scalar);
            }

            // Sync denormalized seller rating columns if schema includes them.
            const string syncWithFlagSql = """
                UPDATE users u
                JOIN (
                    SELECT ratee_id, AVG(score) AS avg_s, COUNT(*) AS c
                    FROM ratings
                    WHERE ratee_id = @uid AND COALESCE(is_flagged, 0) = 0
                    GROUP BY ratee_id
                ) x ON x.ratee_id = u.user_id
                SET u.avg_rating = x.avg_s, u.rating_count = x.c
                WHERE u.user_id = @uid;
                """;

            const string syncNoFlagSql = """
                UPDATE users u
                JOIN (
                    SELECT ratee_id, AVG(score) AS avg_s, COUNT(*) AS c
                    FROM ratings
                    WHERE ratee_id = @uid
                    GROUP BY ratee_id
                ) x ON x.ratee_id = u.user_id
                SET u.avg_rating = x.avg_s, u.rating_count = x.c
                WHERE u.user_id = @uid;
                """;

            try
            {
                await using var syncCmd = new MySqlCommand(syncWithFlagSql, conn, dbTx);
                syncCmd.Parameters.AddWithValue("@uid", sellerId);
                await syncCmd.ExecuteNonQueryAsync(cancellationToken);
            }
            catch (MySqlException mx) when (mx.Number == 1054)
            {
                await using var syncCmd = new MySqlCommand(syncNoFlagSql, conn, dbTx);
                syncCmd.Parameters.AddWithValue("@uid", sellerId);
                await syncCmd.ExecuteNonQueryAsync(cancellationToken);
            }

            await dbTx.CommitAsync(cancellationToken);

            return new UserRatingDto
            {
                RatingId = ratingId,
                ListingId = listingId,
                RaterId = buyerId,
                RaterDisplayName = "",
                RateeId = sellerId,
                Score = score,
                Comment = comment,
                IsFlagged = false,
                IsHarsh = false,
                CreatedAt = DateTime.UtcNow,
            };
        }
        catch
        {
            await dbTx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    /// <summary>
    /// Mid-rank percentile of <c>AVG(score)</c> for <paramref name="sellerUserId"/> vs all distinct <c>ratee_id</c>
    /// with at least <paramref name="minRatingsPerSeller"/> non-flagged ratings (when <c>is_flagged</c> exists).
    /// </summary>
    public async Task<(decimal? Percentile, int PeerSellerCount)> GetSellerAverageRatingPercentileAmongSellersAsync(
        int sellerUserId,
        int minRatingsPerSeller = 1,
        CancellationToken cancellationToken = default)
    {
        if (sellerUserId <= 0)
        {
            return (null, 0);
        }

        if (minRatingsPerSeller < 1)
        {
            minRatingsPerSeller = 1;
        }

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        const string sqlWithFlag = """
            WITH base AS (
                SELECT r.ratee_id AS uid, r.score
                FROM ratings r
                WHERE COALESCE(r.is_flagged, 0) = 0
            ),
            avgs AS (
                SELECT uid, AVG(score) AS avg_s, COUNT(*) AS cnt
                FROM base
                GROUP BY uid
                HAVING cnt >= @min_n
            ),
            mine AS (
                SELECT avg_s FROM avgs WHERE uid = @uid LIMIT 1
            )
            SELECT
                (SELECT COUNT(*) FROM avgs) AS peer_cnt,
                ROUND(
                    100.0 * (
                        SUM(CASE WHEN a.avg_s < m.avg_s THEN 1 ELSE 0 END)
                        + SUM(CASE WHEN a.avg_s = m.avg_s THEN 1 ELSE 0 END) * 0.5
                    ) / NULLIF(COUNT(*), 0)
                , 1) AS pct
            FROM avgs a
            CROSS JOIN mine m;
            """;

        const string sqlNoFlag = """
            WITH avgs AS (
                SELECT ratee_id AS uid, AVG(score) AS avg_s, COUNT(*) AS cnt
                FROM ratings
                GROUP BY ratee_id
                HAVING cnt >= @min_n
            ),
            mine AS (
                SELECT avg_s FROM avgs WHERE uid = @uid LIMIT 1
            )
            SELECT
                (SELECT COUNT(*) FROM avgs) AS peer_cnt,
                ROUND(
                    100.0 * (
                        SUM(CASE WHEN a.avg_s < m.avg_s THEN 1 ELSE 0 END)
                        + SUM(CASE WHEN a.avg_s = m.avg_s THEN 1 ELSE 0 END) * 0.5
                    ) / NULLIF(COUNT(*), 0)
                , 1) AS pct
            FROM avgs a
            CROSS JOIN mine m;
            """;

        async Task<(decimal?, int)> ReadAsync(string sql)
        {
            await using var cmd = new MySqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@uid", sellerUserId);
            cmd.Parameters.AddWithValue("@min_n", minRatingsPerSeller);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return (null, 0);
            }

            var peer = reader.IsDBNull(0) ? 0 : reader.GetInt32(0);
            var pct = reader.IsDBNull(1) ? (decimal?)null : reader.GetDecimal(1);
            return (pct, peer);
        }

        try
        {
            return await ReadAsync(sqlWithFlag);
        }
        catch (MySqlException mx) when (mx.Number == 1054)
        {
            return await ReadAsync(sqlNoFlag);
        }
    }
}

