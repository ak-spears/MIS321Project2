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

    /// <summary>
    /// Public feed: active listings. When <paramref name="excludeSellerId"/> is set (logged-in user),
    /// their own listings are omitted so they appear only under My listings.
    /// </summary>
    public async Task<IReadOnlyList<ListingFeedItemDto>> GetFeedAsync(
        int limit,
        int? campusId,
        int? excludeSellerId,
        CancellationToken cancellationToken = default)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        try
        {
            return await ReadFeedWithGapAsync(conn, limit, campusId, excludeSellerId, cancellationToken);
        }
        catch (Exception ex) when (AsMySqlException(ex) is { } mx && IsUnknownColumnOrBadFieldError(mx))
        {
            // Failed SELECT can poison the connection; minimal query avoids l.image_url for DBs without that column.
            await using var conn2 = new MySqlConnection(_connectionString);
            await conn2.OpenAsync(cancellationToken);
            return await ReadFeedMinimalAsync(conn2, limit, campusId, excludeSellerId, cancellationToken);
        }
    }

    private static async Task<IReadOnlyList<ListingFeedItemDto>> ReadFeedWithGapAsync(
        MySqlConnection conn,
        int limit,
        int? campusId,
        int? excludeSellerId,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT
                l.listing_id,
                l.seller_id,
                l.campus_id,
                l.title,
                l.description,
                l.price,
                l.category,
                l.gap_solution,
                l.image_url,
                l.status,
                l.created_at,
                SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1) AS seller_display_name
            FROM listings l
            INNER JOIN users u ON u.user_id = l.seller_id
            WHERE l.status = 'active'
              AND (@campus_id IS NULL OR l.campus_id = @campus_id)
              AND (@exclude_seller_id IS NULL OR l.seller_id <> @exclude_seller_id)
            ORDER BY l.created_at DESC
            LIMIT @limit;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@limit", limit);
        cmd.Parameters.AddWithValue("@campus_id", campusId.HasValue ? campusId.Value : DBNull.Value);
        cmd.Parameters.AddWithValue("@exclude_seller_id", excludeSellerId.HasValue ? excludeSellerId.Value : DBNull.Value);

        var list = new List<ListingFeedItemDto>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(MapFeedRowWithGap(reader));
        }

        return list;
    }

    private static async Task<IReadOnlyList<ListingFeedItemDto>> ReadFeedMinimalAsync(
        MySqlConnection conn,
        int limit,
        int? campusId,
        int? excludeSellerId,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT
                l.listing_id,
                l.seller_id,
                l.campus_id,
                l.title,
                l.description,
                l.price,
                l.category,
                CAST(NULL AS CHAR) AS image_url,
                l.status,
                l.created_at,
                SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1) AS seller_display_name
            FROM listings l
            INNER JOIN users u ON u.user_id = l.seller_id
            WHERE l.status = 'active'
              AND (@campus_id IS NULL OR l.campus_id = @campus_id)
              AND (@exclude_seller_id IS NULL OR l.seller_id <> @exclude_seller_id)
            ORDER BY l.created_at DESC
            LIMIT @limit;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@limit", limit);
        cmd.Parameters.AddWithValue("@campus_id", campusId.HasValue ? campusId.Value : DBNull.Value);
        cmd.Parameters.AddWithValue("@exclude_seller_id", excludeSellerId.HasValue ? excludeSellerId.Value : DBNull.Value);

        var list = new List<ListingFeedItemDto>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(MapFeedRowMinimal(reader));
        }

        return list;
    }

    public async Task<IReadOnlyList<ListingFeedItemDto>> GetMineAsync(
        int sellerId,
        int limit,
        CancellationToken cancellationToken = default)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        try
        {
            return await ReadMineWithGapAsync(conn, sellerId, limit, cancellationToken);
        }
        catch (Exception ex) when (AsMySqlException(ex) is { } mx && IsUnknownColumnOrBadFieldError(mx))
        {
            await using var conn2 = new MySqlConnection(_connectionString);
            await conn2.OpenAsync(cancellationToken);
            return await ReadMineMinimalAsync(conn2, sellerId, limit, cancellationToken);
        }
    }

    private static async Task<IReadOnlyList<ListingFeedItemDto>> ReadMineWithGapAsync(
        MySqlConnection conn,
        int sellerId,
        int limit,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT
                l.listing_id,
                l.seller_id,
                l.campus_id,
                l.title,
                l.description,
                l.price,
                l.category,
                l.gap_solution,
                l.image_url,
                l.status,
                l.created_at,
                SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1) AS seller_display_name
            FROM listings l
            INNER JOIN users u ON u.user_id = l.seller_id
            WHERE l.seller_id = @seller_id
              AND l.status <> 'removed'
            ORDER BY l.created_at DESC
            LIMIT @limit;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@seller_id", sellerId);
        cmd.Parameters.AddWithValue("@limit", limit);

        var list = new List<ListingFeedItemDto>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(MapFeedRowWithGap(reader));
        }

        return list;
    }

    private static async Task<IReadOnlyList<ListingFeedItemDto>> ReadMineMinimalAsync(
        MySqlConnection conn,
        int sellerId,
        int limit,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT
                l.listing_id,
                l.seller_id,
                l.campus_id,
                l.title,
                l.description,
                l.price,
                l.category,
                CAST(NULL AS CHAR) AS image_url,
                l.status,
                l.created_at,
                SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1) AS seller_display_name
            FROM listings l
            INNER JOIN users u ON u.user_id = l.seller_id
            WHERE l.seller_id = @seller_id
              AND l.status <> 'removed'
            ORDER BY l.created_at DESC
            LIMIT @limit;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@seller_id", sellerId);
        cmd.Parameters.AddWithValue("@limit", limit);

        var list = new List<ListingFeedItemDto>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(MapFeedRowMinimal(reader));
        }

        return list;
    }

    private static ListingFeedItemDto MapFeedRowWithGap(MySqlDataReader reader)
    {
        var ordGap = reader.GetOrdinal("gap_solution");
        return new ListingFeedItemDto
        {
            ListingId = reader.GetInt32(reader.GetOrdinal("listing_id")),
            SellerId = reader.GetInt32(reader.GetOrdinal("seller_id")),
            CampusId = reader.GetInt32(reader.GetOrdinal("campus_id")),
            Title = reader.GetString(reader.GetOrdinal("title")),
            Description = reader.IsDBNull(reader.GetOrdinal("description"))
                ? null
                : reader.GetString(reader.GetOrdinal("description")),
            Price = reader.GetDecimal(reader.GetOrdinal("price")),
            Category = reader.IsDBNull(reader.GetOrdinal("category")) ? null : reader.GetString(reader.GetOrdinal("category")),
            GapSolution = reader.IsDBNull(ordGap) ? null : reader.GetString(ordGap),
            ImageUrl = reader.IsDBNull(reader.GetOrdinal("image_url")) ? null : reader.GetString(reader.GetOrdinal("image_url")),
            Status = reader.GetString(reader.GetOrdinal("status")),
            SellerDisplayName = reader.GetString(reader.GetOrdinal("seller_display_name")),
            CreatedAt = reader.GetDateTime(reader.GetOrdinal("created_at")),
        };
    }

    private static ListingFeedItemDto MapFeedRowMinimal(MySqlDataReader reader)
    {
        return new ListingFeedItemDto
        {
            ListingId = reader.GetInt32(reader.GetOrdinal("listing_id")),
            SellerId = reader.GetInt32(reader.GetOrdinal("seller_id")),
            CampusId = reader.GetInt32(reader.GetOrdinal("campus_id")),
            Title = reader.GetString(reader.GetOrdinal("title")),
            Description = reader.IsDBNull(reader.GetOrdinal("description"))
                ? null
                : reader.GetString(reader.GetOrdinal("description")),
            Price = reader.GetDecimal(reader.GetOrdinal("price")),
            Category = reader.IsDBNull(reader.GetOrdinal("category")) ? null : reader.GetString(reader.GetOrdinal("category")),
            GapSolution = null,
            ImageUrl = reader.IsDBNull(reader.GetOrdinal("image_url")) ? null : reader.GetString(reader.GetOrdinal("image_url")),
            Status = reader.GetString(reader.GetOrdinal("status")),
            SellerDisplayName = reader.GetString(reader.GetOrdinal("seller_display_name")),
            CreatedAt = reader.GetDateTime(reader.GetOrdinal("created_at")),
        };
    }

    public async Task<int?> InsertAsync(int sellerId, CreateListingRequest request, CancellationToken cancellationToken = default)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        const string campusSql = "SELECT campus_id FROM users WHERE user_id = @uid LIMIT 1;";
        int campusId;
        await using (var ccmd = new MySqlCommand(campusSql, conn))
        {
            ccmd.Parameters.AddWithValue("@uid", sellerId);
            var o = await ccmd.ExecuteScalarAsync(cancellationToken);
            if (o is null || o is DBNull)
            {
                return null;
            }

            campusId = Convert.ToInt32(o);
        }

        DateTime? pickupStart = ParseOptionalDate(request.PickupStart);
        DateTime? pickupEnd = ParseOptionalDate(request.PickupEnd);

        try
        {
            await InsertListingRowFullAsync(conn, sellerId, campusId, request, pickupStart, pickupEnd, cancellationToken);
        }
        catch (Exception ex) when (AsMySqlException(ex) is { } mx && IsUnknownColumnOrBadFieldError(mx))
        {
            // Missing some fulfillment columns — still persist gap_solution (delivery / transfer method) + image when possible.
            try
            {
                await InsertListingRowMediumAsync(conn, sellerId, campusId, request, cancellationToken);
            }
            catch (Exception ex2) when (AsMySqlException(ex2) is { } mx2 && IsUnknownColumnOrBadFieldError(mx2))
            {
                await InsertListingRowMinimalAsync(conn, sellerId, campusId, request, cancellationToken);
            }
        }

        await using var idCmd = new MySqlCommand("SELECT LAST_INSERT_ID();", conn);
        var scalar = await idCmd.ExecuteScalarAsync(cancellationToken);
        return Convert.ToInt32(scalar);
    }

    private static MySqlException? AsMySqlException(Exception ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
        {
            if (e is MySqlException mx)
            {
                return mx;
            }
        }

        return null;
    }

    private static bool IsUnknownColumnOrBadFieldError(MySqlException ex) =>
        ex.ErrorCode == MySqlErrorCode.BadFieldError
        || ex.Number == 1054
        || ex.Message.Contains("Unknown column", StringComparison.OrdinalIgnoreCase)
        || ex.Message.Contains("doesn't exist", StringComparison.OrdinalIgnoreCase);

    private static async Task InsertListingRowFullAsync(
        MySqlConnection conn,
        int sellerId,
        int campusId,
        CreateListingRequest request,
        DateTime? pickupStart,
        DateTime? pickupEnd,
        CancellationToken cancellationToken)
    {
        const string insertSql = """
            INSERT INTO listings (
                campus_id, seller_id, title, description, price, category,
                gap_solution, storage_notes, pickup_start, pickup_end, pickup_location, delivery_notes,
                image_url, status
            )
            VALUES (
                @campus_id, @seller_id, @title, @description, @price, @category,
                @gap_solution, @storage_notes, @pickup_start, @pickup_end, @pickup_location, @delivery_notes,
                @image_url, 'active'
            );
            """;

        await using var cmd = new MySqlCommand(insertSql, conn);
        cmd.Parameters.AddWithValue("@campus_id", campusId);
        cmd.Parameters.AddWithValue("@seller_id", sellerId);
        cmd.Parameters.AddWithValue("@title", request.Title.Trim());
        cmd.Parameters.AddWithValue("@description", string.IsNullOrWhiteSpace(request.Description) ? DBNull.Value : request.Description.Trim());
        cmd.Parameters.AddWithValue("@price", request.Price);
        cmd.Parameters.AddWithValue("@category", string.IsNullOrWhiteSpace(request.Category) ? DBNull.Value : request.Category.Trim());
        cmd.Parameters.AddWithValue("@gap_solution", string.IsNullOrWhiteSpace(request.GapSolution) ? DBNull.Value : request.GapSolution.Trim());
        cmd.Parameters.AddWithValue("@storage_notes", string.IsNullOrWhiteSpace(request.StorageNotes) ? DBNull.Value : request.StorageNotes.Trim());
        cmd.Parameters.AddWithValue("@pickup_start", pickupStart.HasValue ? pickupStart.Value.Date : DBNull.Value);
        cmd.Parameters.AddWithValue("@pickup_end", pickupEnd.HasValue ? pickupEnd.Value.Date : DBNull.Value);
        cmd.Parameters.AddWithValue("@pickup_location", string.IsNullOrWhiteSpace(request.PickupLocation) ? DBNull.Value : request.PickupLocation.Trim());
        cmd.Parameters.AddWithValue("@delivery_notes", string.IsNullOrWhiteSpace(request.DeliveryNotes) ? DBNull.Value : request.DeliveryNotes.Trim());
        cmd.Parameters.Add(
            new MySqlParameter("@image_url", MySqlDbType.MediumText)
            {
                Value = string.IsNullOrWhiteSpace(request.ImageUrl) ? DBNull.Value : request.ImageUrl.Trim(),
            });

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>
    /// Inserts core listing fields plus <c>gap_solution</c> (delivery/transfer: storage, pickup_window, ship_or_deliver) and <c>image_url</c>.
    /// Used when full fulfillment columns (pickup dates, etc.) are missing from the schema.
    /// </summary>
    private static async Task InsertListingRowMediumAsync(
        MySqlConnection conn,
        int sellerId,
        int campusId,
        CreateListingRequest request,
        CancellationToken cancellationToken)
    {
        const string insertSql = """
            INSERT INTO listings (
                campus_id, seller_id, title, description, price, category,
                gap_solution, image_url, status
            )
            VALUES (
                @campus_id, @seller_id, @title, @description, @price, @category,
                @gap_solution, @image_url, 'active'
            );
            """;

        await using var cmd = new MySqlCommand(insertSql, conn);
        cmd.Parameters.AddWithValue("@campus_id", campusId);
        cmd.Parameters.AddWithValue("@seller_id", sellerId);
        cmd.Parameters.AddWithValue("@title", request.Title.Trim());
        cmd.Parameters.AddWithValue("@description", string.IsNullOrWhiteSpace(request.Description) ? DBNull.Value : request.Description.Trim());
        cmd.Parameters.AddWithValue("@price", request.Price);
        cmd.Parameters.AddWithValue("@category", string.IsNullOrWhiteSpace(request.Category) ? DBNull.Value : request.Category.Trim());
        cmd.Parameters.AddWithValue("@gap_solution", string.IsNullOrWhiteSpace(request.GapSolution) ? DBNull.Value : request.GapSolution.Trim());
        cmd.Parameters.Add(
            new MySqlParameter("@image_url", MySqlDbType.MediumText)
            {
                Value = string.IsNullOrWhiteSpace(request.ImageUrl) ? DBNull.Value : request.ImageUrl.Trim(),
            });

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task InsertListingRowMinimalAsync(
        MySqlConnection conn,
        int sellerId,
        int campusId,
        CreateListingRequest request,
        CancellationToken cancellationToken)
    {
        const string insertSql = """
            INSERT INTO listings (
                campus_id, seller_id, title, description, price, category,
                image_url, status
            )
            VALUES (
                @campus_id, @seller_id, @title, @description, @price, @category,
                @image_url, 'active'
            );
            """;

        await using var cmd = new MySqlCommand(insertSql, conn);
        cmd.Parameters.AddWithValue("@campus_id", campusId);
        cmd.Parameters.AddWithValue("@seller_id", sellerId);
        cmd.Parameters.AddWithValue("@title", request.Title.Trim());
        cmd.Parameters.AddWithValue("@description", string.IsNullOrWhiteSpace(request.Description) ? DBNull.Value : request.Description.Trim());
        cmd.Parameters.AddWithValue("@price", request.Price);
        cmd.Parameters.AddWithValue("@category", string.IsNullOrWhiteSpace(request.Category) ? DBNull.Value : request.Category.Trim());
        cmd.Parameters.Add(
            new MySqlParameter("@image_url", MySqlDbType.MediumText)
            {
                Value = string.IsNullOrWhiteSpace(request.ImageUrl) ? DBNull.Value : request.ImageUrl.Trim(),
            });

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private static DateTime? ParseOptionalDate(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTime.TryParse(raw, out var d) ? d.Date : null;
    }

    /// <summary>Soft-delete: sets <c>status = 'removed'</c> for the seller&apos;s row.</summary>
    public async Task<bool> DeleteMineAsync(int sellerId, int listingId, CancellationToken cancellationToken = default)
    {
        const string sql = """
            UPDATE listings
            SET status = 'removed'
            WHERE listing_id = @lid AND seller_id = @sid AND status <> 'removed';
            """;

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@lid", listingId);
        cmd.Parameters.AddWithValue("@sid", sellerId);

        var n = await cmd.ExecuteNonQueryAsync(cancellationToken);
        return n > 0;
    }

    public async Task<bool> UpdateMineAsync(
        int sellerId,
        int listingId,
        CreateListingRequest request,
        CancellationToken cancellationToken = default)
    {
        var pickupStart = ParseOptionalDate(request.PickupStart);
        var pickupEnd = ParseOptionalDate(request.PickupEnd);

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        try
        {
            return await UpdateListingRowFullAsync(conn, sellerId, listingId, request, pickupStart, pickupEnd, cancellationToken);
        }
        catch (Exception ex) when (AsMySqlException(ex) is { } mx && IsUnknownColumnOrBadFieldError(mx))
        {
            try
            {
                return await UpdateListingRowMediumAsync(conn, sellerId, listingId, request, cancellationToken);
            }
            catch (Exception ex2) when (AsMySqlException(ex2) is { } mx2 && IsUnknownColumnOrBadFieldError(mx2))
            {
                return await UpdateListingRowMinimalAsync(conn, sellerId, listingId, request, cancellationToken);
            }
        }
    }

    private static async Task<bool> UpdateListingRowFullAsync(
        MySqlConnection conn,
        int sellerId,
        int listingId,
        CreateListingRequest request,
        DateTime? pickupStart,
        DateTime? pickupEnd,
        CancellationToken cancellationToken)
    {
        const string sql = """
            UPDATE listings SET
                title = @title,
                description = @description,
                price = @price,
                category = @category,
                gap_solution = @gap_solution,
                storage_notes = @storage_notes,
                pickup_start = @pickup_start,
                pickup_end = @pickup_end,
                pickup_location = @pickup_location,
                delivery_notes = @delivery_notes,
                image_url = @image_url
            WHERE listing_id = @lid AND seller_id = @sid AND status <> 'removed';
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@lid", listingId);
        cmd.Parameters.AddWithValue("@sid", sellerId);
        cmd.Parameters.AddWithValue("@title", request.Title.Trim());
        cmd.Parameters.AddWithValue("@description", string.IsNullOrWhiteSpace(request.Description) ? DBNull.Value : request.Description.Trim());
        cmd.Parameters.AddWithValue("@price", request.Price);
        cmd.Parameters.AddWithValue("@category", string.IsNullOrWhiteSpace(request.Category) ? DBNull.Value : request.Category.Trim());
        cmd.Parameters.AddWithValue("@gap_solution", string.IsNullOrWhiteSpace(request.GapSolution) ? DBNull.Value : request.GapSolution.Trim());
        cmd.Parameters.AddWithValue("@storage_notes", string.IsNullOrWhiteSpace(request.StorageNotes) ? DBNull.Value : request.StorageNotes.Trim());
        cmd.Parameters.AddWithValue("@pickup_start", pickupStart.HasValue ? pickupStart.Value.Date : DBNull.Value);
        cmd.Parameters.AddWithValue("@pickup_end", pickupEnd.HasValue ? pickupEnd.Value.Date : DBNull.Value);
        cmd.Parameters.AddWithValue("@pickup_location", string.IsNullOrWhiteSpace(request.PickupLocation) ? DBNull.Value : request.PickupLocation.Trim());
        cmd.Parameters.AddWithValue("@delivery_notes", string.IsNullOrWhiteSpace(request.DeliveryNotes) ? DBNull.Value : request.DeliveryNotes.Trim());
        cmd.Parameters.Add(
            new MySqlParameter("@image_url", MySqlDbType.MediumText)
            {
                Value = string.IsNullOrWhiteSpace(request.ImageUrl) ? DBNull.Value : request.ImageUrl.Trim(),
            });

        var n = await cmd.ExecuteNonQueryAsync(cancellationToken);
        return n > 0;
    }

    private static async Task<bool> UpdateListingRowMediumAsync(
        MySqlConnection conn,
        int sellerId,
        int listingId,
        CreateListingRequest request,
        CancellationToken cancellationToken)
    {
        const string sql = """
            UPDATE listings SET
                title = @title,
                description = @description,
                price = @price,
                category = @category,
                gap_solution = @gap_solution,
                image_url = @image_url
            WHERE listing_id = @lid AND seller_id = @sid AND status <> 'removed';
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@lid", listingId);
        cmd.Parameters.AddWithValue("@sid", sellerId);
        cmd.Parameters.AddWithValue("@title", request.Title.Trim());
        cmd.Parameters.AddWithValue("@description", string.IsNullOrWhiteSpace(request.Description) ? DBNull.Value : request.Description.Trim());
        cmd.Parameters.AddWithValue("@price", request.Price);
        cmd.Parameters.AddWithValue("@category", string.IsNullOrWhiteSpace(request.Category) ? DBNull.Value : request.Category.Trim());
        cmd.Parameters.AddWithValue("@gap_solution", string.IsNullOrWhiteSpace(request.GapSolution) ? DBNull.Value : request.GapSolution.Trim());
        cmd.Parameters.Add(
            new MySqlParameter("@image_url", MySqlDbType.MediumText)
            {
                Value = string.IsNullOrWhiteSpace(request.ImageUrl) ? DBNull.Value : request.ImageUrl.Trim(),
            });

        var n = await cmd.ExecuteNonQueryAsync(cancellationToken);
        return n > 0;
    }

    private static async Task<bool> UpdateListingRowMinimalAsync(
        MySqlConnection conn,
        int sellerId,
        int listingId,
        CreateListingRequest request,
        CancellationToken cancellationToken)
    {
        const string sql = """
            UPDATE listings SET
                title = @title,
                description = @description,
                price = @price,
                category = @category,
                image_url = @image_url
            WHERE listing_id = @lid AND seller_id = @sid AND status <> 'removed';
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@lid", listingId);
        cmd.Parameters.AddWithValue("@sid", sellerId);
        cmd.Parameters.AddWithValue("@title", request.Title.Trim());
        cmd.Parameters.AddWithValue("@description", string.IsNullOrWhiteSpace(request.Description) ? DBNull.Value : request.Description.Trim());
        cmd.Parameters.AddWithValue("@price", request.Price);
        cmd.Parameters.AddWithValue("@category", string.IsNullOrWhiteSpace(request.Category) ? DBNull.Value : request.Category.Trim());
        cmd.Parameters.Add(
            new MySqlParameter("@image_url", MySqlDbType.MediumText)
            {
                Value = string.IsNullOrWhiteSpace(request.ImageUrl) ? DBNull.Value : request.ImageUrl.Trim(),
            });

        var n = await cmd.ExecuteNonQueryAsync(cancellationToken);
        return n > 0;
    }

    public async Task<ListingDetailDto?> GetByIdAsync(int listingId, CancellationToken cancellationToken = default)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(cancellationToken);

        try
        {
            return await ReadListingDetailFullAsync(conn, listingId, cancellationToken);
        }
        catch (Exception ex) when (AsMySqlException(ex) is { } mx && IsUnknownColumnOrBadFieldError(mx))
        {
            // Failed SELECT may leave the connection in an error state; use a fresh connection for the minimal query.
            await using var conn2 = new MySqlConnection(_connectionString);
            await conn2.OpenAsync(cancellationToken);
            return await ReadListingDetailMinimalAsync(conn2, listingId, cancellationToken);
        }
    }

    private static async Task<ListingDetailDto?> ReadListingDetailFullAsync(
        MySqlConnection conn,
        int listingId,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT
                l.listing_id,
                l.seller_id,
                l.title,
                l.description,
                l.price,
                l.category,
                l.gap_solution,
                l.storage_notes,
                l.pickup_start,
                l.pickup_end,
                l.pickup_location,
                l.delivery_notes,
                l.image_url,
                l.status,
                l.created_at,
                SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1) AS seller_display_name
            FROM listings l
            INNER JOIN users u ON u.user_id = l.seller_id
            WHERE l.listing_id = @id
            LIMIT 1;
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", listingId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var ordGap = reader.GetOrdinal("gap_solution");
        var ordStorage = reader.GetOrdinal("storage_notes");
        var ordPs = reader.GetOrdinal("pickup_start");
        var ordPe = reader.GetOrdinal("pickup_end");
        var ordPl = reader.GetOrdinal("pickup_location");
        var ordDel = reader.GetOrdinal("delivery_notes");

        return new ListingDetailDto
        {
            ListingId = reader.GetInt32(reader.GetOrdinal("listing_id")),
            SellerId = reader.GetInt32(reader.GetOrdinal("seller_id")),
            Title = reader.GetString(reader.GetOrdinal("title")),
            Description = reader.IsDBNull(reader.GetOrdinal("description"))
                ? null
                : reader.GetString(reader.GetOrdinal("description")),
            Price = reader.GetDecimal(reader.GetOrdinal("price")),
            Category = reader.IsDBNull(reader.GetOrdinal("category")) ? null : reader.GetString(reader.GetOrdinal("category")),
            GapSolution = reader.IsDBNull(ordGap) ? null : reader.GetString(ordGap),
            StorageNotes = reader.IsDBNull(ordStorage) ? null : reader.GetString(ordStorage),
            PickupStart = reader.IsDBNull(ordPs) ? null : reader.GetDateTime(ordPs),
            PickupEnd = reader.IsDBNull(ordPe) ? null : reader.GetDateTime(ordPe),
            PickupLocation = reader.IsDBNull(ordPl) ? null : reader.GetString(ordPl),
            DeliveryNotes = reader.IsDBNull(ordDel) ? null : reader.GetString(ordDel),
            ImageUrl = reader.IsDBNull(reader.GetOrdinal("image_url")) ? null : reader.GetString(reader.GetOrdinal("image_url")),
            Status = reader.GetString(reader.GetOrdinal("status")),
            SellerDisplayName = reader.GetString(reader.GetOrdinal("seller_display_name")),
            CreatedAt = reader.GetDateTime(reader.GetOrdinal("created_at")),
        };
    }

    private static async Task<ListingDetailDto?> ReadListingDetailMinimalAsync(
        MySqlConnection conn,
        int listingId,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT
                l.listing_id,
                l.seller_id,
                l.title,
                l.description,
                l.price,
                l.category,
                CAST(NULL AS CHAR) AS image_url,
                l.status,
                l.created_at,
                SUBSTRING_INDEX(LOWER(TRIM(COALESCE(u.email, ''))), '@', 1) AS seller_display_name
            FROM listings l
            INNER JOIN users u ON u.user_id = l.seller_id
            WHERE l.listing_id = @id
            LIMIT 1;
            """;

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
            SellerId = reader.GetInt32(reader.GetOrdinal("seller_id")),
            Title = reader.GetString(reader.GetOrdinal("title")),
            Description = reader.IsDBNull(reader.GetOrdinal("description"))
                ? null
                : reader.GetString(reader.GetOrdinal("description")),
            Price = reader.GetDecimal(reader.GetOrdinal("price")),
            Category = reader.IsDBNull(reader.GetOrdinal("category")) ? null : reader.GetString(reader.GetOrdinal("category")),
            GapSolution = null,
            StorageNotes = null,
            PickupStart = null,
            PickupEnd = null,
            PickupLocation = null,
            DeliveryNotes = null,
            ImageUrl = reader.IsDBNull(reader.GetOrdinal("image_url")) ? null : reader.GetString(reader.GetOrdinal("image_url")),
            Status = reader.GetString(reader.GetOrdinal("status")),
            SellerDisplayName = reader.GetString(reader.GetOrdinal("seller_display_name")),
            CreatedAt = reader.GetDateTime(reader.GetOrdinal("created_at")),
        };
    }
}
