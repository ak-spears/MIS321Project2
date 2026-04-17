using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using FullstackWithLlm.Api.Models;
using MySqlConnector;

namespace FullstackWithLlm.Api.Services;

public sealed class ListingMatchService
{
    private readonly string _connectionString;
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;

    public ListingMatchService(IConfiguration configuration, HttpClient httpClient)
    {
        _configuration = configuration;
        _httpClient = httpClient;
        var cs = configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(cs))
        {
            throw new InvalidOperationException("Missing connection string: ConnectionStrings:DefaultConnection.");
        }

        _connectionString = cs;
    }

    public async Task<Dictionary<int, (int Score, string? Reason, DateTime ScoredAt)>> EnsureScoresForFeedAsync(
        int userId,
        IReadOnlyList<ListingFeedItemDto> listings,
        CancellationToken cancellationToken = default)
    {
        var byId = new Dictionary<int, (int Score, string? Reason, DateTime ScoredAt)>();
        if (userId <= 0 || listings.Count == 0)
        {
            return byId;
        }

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await EnsureListingScoresTableAsync(conn, cancellationToken);

        foreach (var listing in listings)
        {
            var existing = await ReadScoreRowAsync(conn, listing.ListingId, userId, cancellationToken);
            var listingFreshAt = listing.CreatedAt;
            var needsScore = existing is null || existing.Value.ScoredAt < listingFreshAt;
            if (needsScore)
            {
                var generated = await GenerateScoreAndReasonAsync(userId, listing, includeReason: false, cancellationToken);
                var persistedReason = existing.HasValue ? existing.Value.Reason : null;
                await UpsertScoreRowAsync(
                    conn,
                    listing.ListingId,
                    userId,
                    generated.Score,
                    persistedReason,
                    DateTime.UtcNow,
                    cancellationToken);

                byId[listing.ListingId] = (generated.Score, persistedReason, DateTime.UtcNow);
                continue;
            }

            if (!existing.HasValue)
            {
                continue;
            }

            var cached = existing.Value;
            byId[listing.ListingId] = (cached.Score, cached.Reason, cached.ScoredAt);
        }

        return byId;
    }

    public async Task<ListingMatchReasonDto?> GetOrGenerateReasonAsync(
        int userId,
        ListingDetailDto listing,
        CancellationToken cancellationToken = default)
    {
        if (userId <= 0)
        {
            return null;
        }

        var feedListing = ToFeedItem(listing);

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await EnsureListingScoresTableAsync(conn, cancellationToken);

        var existing = await ReadScoreRowAsync(conn, listing.ListingId, userId, cancellationToken);
        var listingFreshAt = listing.CreatedAt ?? DateTime.UtcNow;
        var needsRescore = existing is null || existing.Value.ScoredAt < listingFreshAt;

        if (existing is { } rowOk && !needsRescore && !string.IsNullOrWhiteSpace(rowOk.Reason))
        {
            return new ListingMatchReasonDto
            {
                ListingId = listing.ListingId,
                Score = rowOk.Score,
                Reason = rowOk.Reason,
            };
        }

        var user = await ReadUserContextAsync(userId, cancellationToken);
        int canonicalScore;

        if (needsRescore || existing is null)
        {
            var generated = await GenerateScoreAndReasonAsync(userId, feedListing, includeReason: false, cancellationToken);
            canonicalScore = generated.Score;
            await UpsertScoreRescoreAsync(conn, listing.ListingId, userId, canonicalScore, DateTime.UtcNow, cancellationToken);
        }
        else
        {
            canonicalScore = existing!.Value.Score;
        }

        var reason = await GenerateReasonOnlyAsync(
            user,
            feedListing,
            canonicalScore,
            cancellationToken);
        reason = SanitizeVagueReason(reason, feedListing);
        await UpdateReasonAsync(conn, listing.ListingId, userId, reason, cancellationToken);

        return new ListingMatchReasonDto
        {
            ListingId = listing.ListingId,
            Score = canonicalScore,
            Reason = reason,
        };
    }

    public async Task<ListingMatchReasonDto> GenerateGuestReasonAsync(
        ListingDetailDto listing,
        CancellationToken cancellationToken = default)
    {
        var feedListing = ToFeedItem(listing);
        var guestScore = GuestDisplayScore(feedListing);
        var reason = await GenerateReasonOnlyAsync(
            (null, null, null),
            feedListing,
            guestScore,
            cancellationToken);
        reason = SanitizeVagueReason(reason, feedListing);

        return new ListingMatchReasonDto
        {
            ListingId = listing.ListingId,
            Score = guestScore,
            Reason = reason,
        };
    }

    private static ListingFeedItemDto ToFeedItem(ListingDetailDto listing) =>
        new()
        {
            ListingId = listing.ListingId,
            Title = listing.Title,
            Description = listing.Description,
            Category = listing.Category,
            Price = listing.Price,
            Condition = listing.Condition,
            GapSolution = listing.GapSolution,
            SpaceSuitability = listing.SpaceSuitability,
            CreatedAt = listing.CreatedAt ?? DateTime.UtcNow,
        };

    /// <summary>Aligns with frontend <c>estimateFallbackMatchScore</c> for guests (no JWT).</summary>
    private static int GuestDisplayScore(ListingFeedItemDto listing)
    {
        var score = 58;
        if (listing.Price == 0)
        {
            score += 8;
        }

        var c = (listing.Condition ?? "").Trim().ToLowerInvariant();
        if (c is "new" or "like_new")
        {
            score += 12;
        }
        else if (c == "good")
        {
            score += 6;
        }
        else if (c == "fair")
        {
            score += 2;
        }

        if (!string.IsNullOrWhiteSpace(listing.SpaceSuitability))
        {
            score += 6;
        }

        if (!string.IsNullOrWhiteSpace(listing.GapSolution))
        {
            score += 6;
        }

        if (!string.IsNullOrWhiteSpace(listing.Category))
        {
            score += 4;
        }

        return Math.Clamp(score, 0, 100);
    }

    private async Task<(int Score, string? Reason)> GenerateScoreAndReasonAsync(
        int userId,
        ListingFeedItemDto listing,
        bool includeReason,
        CancellationToken cancellationToken)
    {
        var user = await ReadUserContextAsync(userId, cancellationToken);
        return await GenerateScoreAndReasonAsync(user, listing, includeReason, cancellationToken);
    }

    private async Task<(int Score, string? Reason)> GenerateScoreAndReasonAsync(
        (string? DormBuilding, DateTime? MoveInDate, string? PreferredReceiveGap) user,
        ListingFeedItemDto listing,
        bool includeReason,
        CancellationToken cancellationToken)
    {
        var apiKey = _configuration["OPENAI_API_KEY"] ?? _configuration["OpenAI:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return (FallbackScore(user, listing), includeReason ? "General dorm fit based on listing basics and your move-in profile." : null);
        }

        var model = _configuration["OpenAI:Model"] ?? "gpt-4o-mini";
        var prompt = BuildPrompt(user, listing, includeReason);
        var payload = new
        {
            model,
            temperature = 0.2,
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content =
                        "Return strict JSON only: {\"score\": integer 0-100, \"reason\": \"one short sentence\"}. "
                        + "reason must be at most 120 characters, plain text, no quotes inside. "
                        + "Prioritize how well the item fits the buyer's dorm/living situation (use user dorm + listing space_suitability when present) "
                        + "and what the listing description says; mention price/condition only if they matter for fit. "
                        + "If user's dorm/space prefs are unknown, infer fit from listing title, description, and space_suitability.",
                },
                new
                {
                    role = "user",
                    content = prompt,
                },
            },
        };

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            using var res = await _httpClient.SendAsync(req, cancellationToken);
            var content = await res.Content.ReadAsStringAsync(cancellationToken);
            if (!res.IsSuccessStatusCode)
            {
                return (FallbackScore(user, listing), includeReason ? "General dorm fit based on listing basics and your move-in profile." : null);
            }

            using var doc = JsonDocument.Parse(content);
            var msg = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "{}";
            using var inner = JsonDocument.Parse(msg);
            var score = inner.RootElement.TryGetProperty("score", out var s) ? s.GetInt32() : FallbackScore(user, listing);
            score = Math.Clamp(score, 0, 100);
            string? reason = null;
            if (includeReason && inner.RootElement.TryGetProperty("reason", out var r))
            {
                reason = ClampReasonSentence(r.GetString()?.Trim());
            }

            return (score, includeReason ? reason : null);
        }
        catch
        {
            return (FallbackScore(user, listing), includeReason ? "General dorm fit based on listing basics and your move-in profile." : null);
        }
    }

    /// <summary>
    /// The feed already fixed <paramref name="fixedScore"/>; only explain it — never invent a new percentage.
    /// </summary>
    private async Task<string> GenerateReasonOnlyAsync(
        (string? DormBuilding, DateTime? MoveInDate, string? PreferredReceiveGap) user,
        ListingFeedItemDto listing,
        int fixedScore,
        CancellationToken cancellationToken)
    {
        var clamped = Math.Clamp(fixedScore, 0, 100);
        var apiKey = _configuration["OPENAI_API_KEY"] ?? _configuration["OpenAI:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return BuildTemplateReason(listing);
        }

        var model = _configuration["OpenAI:Model"] ?? "gpt-4o-mini";
        var prompt = BuildReasonOnlyPrompt(user, listing, clamped);
        var payload = new
        {
            model,
            temperature = 0.25,
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content =
                        "Return strict JSON only: {\"reason\": \"one short sentence\"}. "
                        + "The match percentage is ALREADY DECIDED — do not mention a different percentage, do not question the score. "
                        + "reason at most 120 characters. "
                        + "Write a positive, concrete line about dorm/living-space fit: buyer dorm/preferences + listing title/category/space_suitability/gap_solution/condition. "
                        + "NEVER use: unclear, vague, uncertain, insufficient, lack of details, not enough information. "
                        + "If description is thin, infer one plausible fit from title + category + space_suitability + condition.",
                },
                new
                {
                    role = "user",
                    content = prompt,
                },
            },
        };

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            using var res = await _httpClient.SendAsync(req, cancellationToken);
            var content = await res.Content.ReadAsStringAsync(cancellationToken);
            if (!res.IsSuccessStatusCode)
            {
                return BuildTemplateReason(listing);
            }

            using var doc = JsonDocument.Parse(content);
            var msg = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString() ?? "{}";
            using var inner = JsonDocument.Parse(msg);
            var reason = inner.RootElement.TryGetProperty("reason", out var r) ? r.GetString()?.Trim() : null;
            reason = ClampReasonSentence(reason);
            return string.IsNullOrWhiteSpace(reason) ? BuildTemplateReason(listing) : reason!;
        }
        catch
        {
            return BuildTemplateReason(listing);
        }
    }

    private static string BuildReasonOnlyPrompt(
        (string? DormBuilding, DateTime? MoveInDate, string? PreferredReceiveGap) user,
        ListingFeedItemDto listing,
        int fixedScore)
    {
        var desc = (listing.Description ?? "").Trim();
        if (desc.Length > 400)
        {
            desc = desc[..400] + "…";
        }

        return
            $"Fixed match score (do not change): {fixedScore}/100.\n"
            + $"Buyer / living context: dorm_building={user.DormBuilding ?? "unknown"}, move_in={user.MoveInDate?.ToString("yyyy-MM-dd") ?? "unknown"}, preferred_pickup_gap={user.PreferredReceiveGap ?? "unknown"}.\n"
            + $"Listing: title={listing.Title}, category={listing.Category ?? "unknown"}, item_condition={listing.Condition ?? "unknown"}, "
            + $"price={listing.Price:0.00}, gap_solution={listing.GapSolution ?? "unknown"}, space_suitability={listing.SpaceSuitability ?? "unknown"}.\n"
            + $"Listing description (may be truncated): {desc}\n"
            + "Explain in ONE sentence why this score makes sense for this buyer and listing (space/dorm fit first).";
    }

    private static string SanitizeVagueReason(string? reason, ListingFeedItemDto listing)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            return BuildTemplateReason(listing);
        }

        var lower = reason.ToLowerInvariant();
        var banned = new[]
        {
            "unclear", "uncertain", "vague", "insufficient", "lack of details", "lack of detail",
            "not enough information", "not enough info", "doesn't specify", "does not specify",
        };

        foreach (var b in banned)
        {
            if (lower.Contains(b))
            {
                return BuildTemplateReason(listing);
            }
        }

        return reason.Trim();
    }

    private static string BuildTemplateReason(ListingFeedItemDto listing)
    {
        var cat = string.IsNullOrWhiteSpace(listing.Category) ? "this item" : listing.Category.Trim();
        var spaceNote = (listing.SpaceSuitability ?? "").Trim().ToLowerInvariant() switch
        {
            "small_dorm" => "compact dorm rooms",
            "any_space" => "typical dorm setups",
            _ => "campus housing",
        };

        return $"Strong dorm fit for {cat}: suits {spaceNote} given how it’s listed.";
    }

    private static async Task UpsertScoreRescoreAsync(
        MySqlConnection conn,
        int listingId,
        int userId,
        int score,
        DateTime createdAtUtc,
        CancellationToken cancellationToken)
    {
        const string sql = """
            INSERT INTO listing_scores (listing_id, user_id, score, reason, created_at)
            VALUES (@lid, @uid, @score, NULL, @created_at)
            ON DUPLICATE KEY UPDATE
                score = VALUES(score),
                reason = NULL,
                created_at = VALUES(created_at);
            """;
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@lid", listingId);
        cmd.Parameters.AddWithValue("@uid", userId);
        cmd.Parameters.AddWithValue("@score", Math.Clamp(score, 0, 100));
        cmd.Parameters.AddWithValue("@created_at", createdAtUtc);
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task UpdateReasonAsync(
        MySqlConnection conn,
        int listingId,
        int userId,
        string reason,
        CancellationToken cancellationToken)
    {
        const string sql = """
            UPDATE listing_scores
            SET reason = @reason
            WHERE listing_id = @lid AND user_id = @uid;
            """;
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@lid", listingId);
        cmd.Parameters.AddWithValue("@uid", userId);
        cmd.Parameters.AddWithValue("@reason", reason.Trim());
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private static int FallbackScore((string? DormBuilding, DateTime? MoveInDate, string? PreferredReceiveGap) user, ListingFeedItemDto listing)
    {
        var score = 55;
        if (listing.Price == 0)
        {
            score += 6;
        }

        if (!string.IsNullOrWhiteSpace(user.PreferredReceiveGap)
            && !string.IsNullOrWhiteSpace(listing.GapSolution)
            && string.Equals(user.PreferredReceiveGap.Trim(), listing.GapSolution.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            score += 20;
        }

        if (!string.IsNullOrWhiteSpace(listing.SpaceSuitability))
        {
            score += 8;
        }

        if (!string.IsNullOrWhiteSpace(listing.Condition))
        {
            var c = listing.Condition.Trim().ToLowerInvariant();
            if (c is "new" or "like_new")
            {
                score += 8;
            }
            else if (c == "good")
            {
                score += 4;
            }
        }

        if (!string.IsNullOrWhiteSpace(listing.Category))
        {
            score += 3;
        }

        return Math.Clamp(score, 0, 100);
    }

    private static string? ClampReasonSentence(string? reason, int maxLen = 120)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            return null;
        }

        reason = reason.Trim().Replace('\n', ' ');
        return reason.Length <= maxLen ? reason : reason[..(maxLen - 1)] + "…";
    }

    private static string BuildPrompt(
        (string? DormBuilding, DateTime? MoveInDate, string? PreferredReceiveGap) user,
        ListingFeedItemDto listing,
        bool includeReason)
    {
        var desc = (listing.Description ?? "").Trim();
        if (desc.Length > 400)
        {
            desc = desc[..400] + "…";
        }

        return
            $"Buyer / living context: dorm_building={user.DormBuilding ?? "unknown"}, move_in={user.MoveInDate?.ToString("yyyy-MM-dd") ?? "unknown"}, preferred_pickup_gap={user.PreferredReceiveGap ?? "unknown"}.\n"
            + $"Listing: title={listing.Title}, category={listing.Category ?? "unknown"}, item_condition={listing.Condition ?? "unknown"}, "
            + $"price={listing.Price:0.00}, gap_solution={listing.GapSolution ?? "unknown"}, space_suitability={listing.SpaceSuitability ?? "unknown"}.\n"
            + $"Listing description (may be truncated): {desc}\n"
            + (includeReason
                ? "Score and reason: weigh dorm/living-space fit first (space_suitability vs buyer dorm, description about size/use). Keep reason one short sentence, space-focused."
                : "Return score only; reason may be empty string.");
    }

    private async Task<(string? DormBuilding, DateTime? MoveInDate, string? PreferredReceiveGap)> ReadUserContextAsync(
        int userId,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT dorm_building, move_in_date, preferred_receive_gap
            FROM users
            WHERE user_id = @uid
            LIMIT 1;
            """;

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@uid", userId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return (null, null, null);
        }

        var dorm = reader.IsDBNull(0) ? null : reader.GetString(0);
        DateTime? moveIn = reader.IsDBNull(1) ? null : reader.GetDateTime(1);
        var pref = reader.IsDBNull(2) ? null : reader.GetString(2);
        return (dorm, moveIn, pref);
    }

    private static async Task EnsureListingScoresTableAsync(MySqlConnection conn, CancellationToken cancellationToken)
    {
        const string sql = """
            CREATE TABLE IF NOT EXISTS listing_scores (
                listing_id INT NOT NULL,
                user_id INT NOT NULL,
                score INT NOT NULL,
                reason VARCHAR(255) DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (listing_id, user_id),
                CONSTRAINT fk_listing_scores_listing FOREIGN KEY (listing_id) REFERENCES listings (listing_id) ON DELETE CASCADE,
                CONSTRAINT fk_listing_scores_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
            );
            """;
        await using var cmd = new MySqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<(int Score, string? Reason, DateTime ScoredAt)?> ReadScoreRowAsync(
        MySqlConnection conn,
        int listingId,
        int userId,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT score, reason, created_at
            FROM listing_scores
            WHERE listing_id = @lid AND user_id = @uid
            LIMIT 1;
            """;
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@lid", listingId);
        cmd.Parameters.AddWithValue("@uid", userId);
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var score = reader.GetInt32(0);
        var reason = reader.IsDBNull(1) ? null : reader.GetString(1);
        var createdAt = reader.GetDateTime(2);
        return (score, reason, createdAt);
    }

    private static async Task UpsertScoreRowAsync(
        MySqlConnection conn,
        int listingId,
        int userId,
        int score,
        string? reason,
        DateTime createdAtUtc,
        CancellationToken cancellationToken)
    {
        const string sql = """
            INSERT INTO listing_scores (listing_id, user_id, score, reason, created_at)
            VALUES (@lid, @uid, @score, @reason, @created_at)
            ON DUPLICATE KEY UPDATE
                score = VALUES(score),
                reason = COALESCE(VALUES(reason), reason),
                created_at = VALUES(created_at);
            """;
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@lid", listingId);
        cmd.Parameters.AddWithValue("@uid", userId);
        cmd.Parameters.AddWithValue("@score", Math.Clamp(score, 0, 100));
        cmd.Parameters.AddWithValue("@reason", string.IsNullOrWhiteSpace(reason) ? DBNull.Value : reason.Trim());
        cmd.Parameters.AddWithValue("@created_at", createdAtUtc);
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
