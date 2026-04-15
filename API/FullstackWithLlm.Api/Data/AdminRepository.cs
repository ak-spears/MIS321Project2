using FullstackWithLlm.Api.Models;
using MySqlConnector;

namespace FullstackWithLlm.Api.Data;

public sealed class AdminRepository
{
    private readonly string _connectionString;

    public AdminRepository(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection") ?? "";
    }

    public async Task<AdminDashboardDto> GetDashboardAsync(int weeks, CancellationToken cancellationToken = default)
    {
        if (weeks < 1) weeks = 1;
        if (weeks > 52) weeks = 52;

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        var newListings = await ReadWeeklyNewListingsAsync(conn, weeks, cancellationToken);
        var revenue = await ReadWeeklyRevenueAsync(conn, weeks, cancellationToken);
        var donationHandoffs = await ReadDonationHandoffSummaryAsync(conn, cancellationToken);
        var lowRated = await ReadLowRatedUsersAsync(conn, cancellationToken);
        var flagged = await ReadFlaggedOrHarshReviewsAsync(conn, cancellationToken);

        return new AdminDashboardDto
        {
            NewListingsByWeek = newListings,
            RevenueByWeek = revenue,
            DonationHandoffs = donationHandoffs,
            LowRatedUsers = lowRated,
            FlaggedOrHarshReviews = flagged,
        };
    }

    private static async Task<IReadOnlyList<WeeklyCountDto>> ReadWeeklyNewListingsAsync(
        MySqlConnection conn,
        int weeks,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT DATE(DATE_SUB(created_at, INTERVAL WEEKDAY(created_at) DAY)) AS week_start,
                   COUNT(*) AS c
            FROM listings
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL @Weeks WEEK)
              AND status <> 'removed'
            GROUP BY week_start
            ORDER BY week_start DESC;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@Weeks", weeks);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        var rows = new List<WeeklyCountDto>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var weekStart = reader.GetDateTime(0).ToString("yyyy-MM-dd");
            rows.Add(new WeeklyCountDto { WeekStart = weekStart, Count = reader.GetInt32(1) });
        }

        return rows;
    }

    private static async Task<IReadOnlyList<WeeklyRevenueDto>> ReadWeeklyRevenueAsync(
        MySqlConnection conn,
        int weeks,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT DATE(DATE_SUB(created_at, INTERVAL WEEKDAY(created_at) DAY)) AS week_start,
                   COUNT(*) AS txns,
                   COALESCE(SUM(amount), 0) AS gross,
                   COALESCE(SUM(platform_fee), 0) AS fees
            FROM transactions
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL @Weeks WEEK)
              AND status = 'completed'
            GROUP BY week_start
            ORDER BY week_start DESC;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@Weeks", weeks);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        var rows = new List<WeeklyRevenueDto>();
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new WeeklyRevenueDto
            {
                WeekStart = reader.GetDateTime(0).ToString("yyyy-MM-dd"),
                CompletedTransactions = reader.GetInt32(1),
                GrossAmount = reader.GetDecimal(2),
                PlatformFees = reader.GetDecimal(3),
            });
        }

        return rows;
    }

    private static async Task<DonationHandoffSummaryDto> ReadDonationHandoffSummaryAsync(
        MySqlConnection conn,
        CancellationToken cancellationToken)
    {
        // donation_handed_off_at is added via an alter script (nullable). If missing, treat as all "not picked up".
        const string sql = """
            SELECT
                SUM(CASE WHEN price = 0 AND donation_handed_off_at IS NOT NULL AND status <> 'removed' THEN 1 ELSE 0 END) AS picked_up,
                SUM(CASE WHEN price = 0 AND donation_handed_off_at IS NULL AND status <> 'removed' THEN 1 ELSE 0 END) AS not_picked_up
            FROM listings;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        try
        {
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return new DonationHandoffSummaryDto();
            }

            return new DonationHandoffSummaryDto
            {
                PickedUpCount = reader.IsDBNull(0) ? 0 : reader.GetInt32(0),
                NotPickedUpCount = reader.IsDBNull(1) ? 0 : reader.GetInt32(1),
            };
        }
        catch (MySqlException mx) when (mx.Number == 1054)
        {
            // Unknown column donation_handed_off_at
            return new DonationHandoffSummaryDto { PickedUpCount = 0, NotPickedUpCount = 0 };
        }
    }

    private static async Task<IReadOnlyList<LowRatedUserDto>> ReadLowRatedUsersAsync(
        MySqlConnection conn,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT u.user_id,
                   u.display_name,
                   AVG(r.score) AS avg_score,
                   COUNT(*) AS c
            FROM ratings r
            JOIN users u ON u.user_id = r.ratee_id
            GROUP BY u.user_id, u.display_name
            HAVING c >= 1 AND avg_score <= 3.0
            ORDER BY avg_score ASC, c DESC
            LIMIT 50;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        var rows = new List<LowRatedUserDto>();
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new LowRatedUserDto
            {
                UserId = reader.GetInt32(0),
                DisplayName = reader.GetString(1),
                AvgRating = reader.IsDBNull(2) ? 0 : reader.GetDecimal(2),
                RatingCount = reader.GetInt32(3),
            });
        }

        return rows;
    }

    private static async Task<IReadOnlyList<FlaggedReviewDto>> ReadFlaggedOrHarshReviewsAsync(
        MySqlConnection conn,
        CancellationToken cancellationToken)
    {
        // is_flagged / is_harsh are added via alter script; if missing, return empty.
        const string sql = """
            SELECT rating_id, listing_id, rater_id, ratee_id, score, comment,
                   COALESCE(is_flagged, 0) AS is_flagged,
                   COALESCE(is_harsh, 0) AS is_harsh,
                   created_at
            FROM ratings
            WHERE (COALESCE(is_flagged, 0) = 1 OR COALESCE(is_harsh, 0) = 1 OR score <= 3)
            ORDER BY created_at DESC
            LIMIT 100;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        try
        {
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            var rows = new List<FlaggedReviewDto>();
            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(new FlaggedReviewDto
                {
                    RatingId = reader.GetInt32(0),
                    ListingId = reader.GetInt32(1),
                    RaterId = reader.GetInt32(2),
                    RateeId = reader.GetInt32(3),
                    Score = reader.GetByte(4),
                    Comment = reader.IsDBNull(5) ? null : reader.GetString(5),
                    IsFlagged = !reader.IsDBNull(6) && reader.GetInt32(6) == 1,
                    IsHarsh = !reader.IsDBNull(7) && reader.GetInt32(7) == 1,
                    CreatedAt = reader.GetDateTime(8).ToString("s"),
                });
            }

            return rows;
        }
        catch (MySqlException mx) when (mx.Number == 1054)
        {
            return Array.Empty<FlaggedReviewDto>();
        }
    }
}

