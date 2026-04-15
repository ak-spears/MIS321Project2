using System.Text.RegularExpressions;
using FullstackWithLlm.Api.Models;
using MySqlConnector;

namespace FullstackWithLlm.Api.Data;

public sealed class UserRepository
{
    private static readonly Regex UnknownColumnRegex = new(
        @"Unknown column\s+'([^']+)'",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private readonly string _connectionString;

    public UserRepository(IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "Missing connection string: ConnectionStrings:DefaultConnection (env: ConnectionStrings__DefaultConnection).");
        }

        _connectionString = connectionString;
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

    private static bool IsUnknownColumnDbError(MySqlException ex) =>
        ex.ErrorCode == MySqlErrorCode.BadFieldError
        || ex.Number == 1054
        || ex.Message.Contains("Unknown column", StringComparison.OrdinalIgnoreCase);

    private static string DisplayNameFromEmail(string email)
    {
        var trimmed = email.Trim();
        var at = trimmed.IndexOf('@');
        var local = at > 0 ? trimmed[..at] : trimmed;
        if (local.Length > 60)
        {
            local = local[..60];
        }

        return string.IsNullOrEmpty(local) ? "User" : local;
    }

    private static MySqlException? FindMySqlException(Exception? ex)
    {
        while (ex != null)
        {
            if (ex is MySqlException mx)
            {
                return mx;
            }

            ex = ex.InnerException;
        }

        return null;
    }

    private static bool IsDuplicateKey(MySqlException? mx) =>
        mx != null && (mx.ErrorCode == MySqlErrorCode.DuplicateKeyEntry || mx.Number == 1062);

    private static bool IsBadField(MySqlException? mx) =>
        mx != null && (mx.ErrorCode == MySqlErrorCode.BadFieldError || mx.Number == 1054);

    /// <summary>1364 — NOT NULL column missing from INSERT with no default.</summary>
    private static bool IsNoDefaultForField(MySqlException? mx) =>
        mx != null && mx.Number == 1364;

    private static string? ParseUnknownColumnName(MySqlException mx)
    {
        var m = UnknownColumnRegex.Match(mx.Message);
        if (!m.Success)
        {
            return null;
        }

        var raw = m.Groups[1].Value;
        var dot = raw.LastIndexOf('.');
        return dot >= 0 ? raw[(dot + 1)..] : raw;
    }

    private static bool MissingFieldHint(MySqlException? mx, string field) =>
        mx != null && mx.Message.Contains(field, StringComparison.OrdinalIgnoreCase);

    private static int ColumnIndex(MySqlDataReader r, string columnName)
    {
        for (var i = 0; i < r.FieldCount; i++)
        {
            if (string.Equals(r.GetName(i), columnName, StringComparison.OrdinalIgnoreCase))
            {
                return i;
            }
        }

        return -1;
    }

    private static async Task<int> GetDefaultCampusIdAsync(MySqlConnection connection)
    {
        const string sql = """
            SELECT campus_id
            FROM campuses
            ORDER BY campus_id
            LIMIT 1;
            """;

        await using var cmd = new MySqlCommand(sql, connection);
        var obj = await cmd.ExecuteScalarAsync();
        if (obj is null || obj is DBNull)
        {
            throw new InvalidOperationException(
                "No campus row found. Run database/marketplace_schema.sql (seed inserts University of Alabama).");
        }

        return Convert.ToInt32(obj);
    }

    public async Task<User?> GetByEmailAsync(string email)
    {
        var normalized = email.Trim().ToLowerInvariant();
        var columns = new List<string>
        {
            "user_id", "campus_id", "email", "password_hash", "phone", "lives_on_campus",
            "move_in_date", "move_out_date", "dorm_building", "suite_letter",
        };

        for (var attempt = 0; attempt < 32; attempt++)
        {
            await using var connection = new MySqlConnection(_connectionString);
            await connection.OpenAsync();

            var sql = $"""
                SELECT {string.Join(", ", columns)}
                FROM users
                WHERE LOWER(TRIM(email)) = @Email
                LIMIT 1;
                """;

            try
            {
                await using var command = new MySqlCommand(sql, connection);
                command.Parameters.AddWithValue("@Email", normalized);

                await using var reader = await command.ExecuteReaderAsync();
                if (!await reader.ReadAsync())
                {
                    return null;
                }

                return MapUserFromReader(reader);
            }
            catch (Exception ex) when (FindMySqlException(ex) is { } mx && IsBadField(mx) && ParseUnknownColumnName(mx) is { } bad)
            {
                if (!TryRemoveSelectableColumn(columns, bad))
                {
                    throw;
                }
            }
        }

        throw new InvalidOperationException("Could not load user: too many schema adaptation steps.");
    }

    private static User MapUserFromReader(MySqlDataReader r)
    {
        var email = r.GetString(ColumnIndex(r, "email"));
        var user = new User
        {
            Id = r.GetInt32(ColumnIndex(r, "user_id")),
            CampusId = r.GetInt32(ColumnIndex(r, "campus_id")),
            Email = email,
            PasswordHash = r.GetString(ColumnIndex(r, "password_hash")),
            DisplayName = DisplayNameFromEmail(email),
        };

        var pi = ColumnIndex(r, "phone");
        user.Phone = pi >= 0 && !r.IsDBNull(pi) ? r.GetString(pi) : "";

        var li = ColumnIndex(r, "lives_on_campus");
        user.LivesOnCampus = li >= 0 && !r.IsDBNull(li) && r.GetBoolean(li);

        var mi = ColumnIndex(r, "move_in_date");
        user.MoveDate = mi >= 0 && !r.IsDBNull(mi) ? r.GetDateTime(mi) : DateTime.UtcNow.Date;

        var mo = ColumnIndex(r, "move_out_date");
        user.MoveOutDate = mo >= 0 && !r.IsDBNull(mo) ? r.GetDateTime(mo) : null;

        var db = ColumnIndex(r, "dorm_building");
        user.DormBuilding = db >= 0 && !r.IsDBNull(db) ? r.GetString(db) : null;

        var sl = ColumnIndex(r, "suite_letter");
        if (sl >= 0 && !r.IsDBNull(sl))
        {
            var s = r.GetString(sl);
            user.SuiteLetter = s.Length > 0 ? char.ToUpperInvariant(s[0]) : null;
        }

        return user;
    }

    public async Task<UserProfileDto?> GetProfileByIdAsync(int userId, CancellationToken cancellationToken = default)
    {
        await using var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);

        const string sqlFull = """
            SELECT user_id, campus_id, email, display_name, phone, lives_on_campus,
                   move_in_date, move_out_date, dorm_building, suite_letter, avatar_url,
                   default_gap_solution, preferred_receive_gap
            FROM users
            WHERE user_id = @UserId
            LIMIT 1;
            """;

        const string sqlDefaultGapOnly = """
            SELECT user_id, campus_id, email, display_name, phone, lives_on_campus,
                   move_in_date, move_out_date, dorm_building, suite_letter, avatar_url,
                   default_gap_solution
            FROM users
            WHERE user_id = @UserId
            LIMIT 1;
            """;

        const string sqlLegacy = """
            SELECT user_id, campus_id, email, display_name, phone, lives_on_campus,
                   move_in_date, move_out_date, dorm_building, suite_letter, avatar_url
            FROM users
            WHERE user_id = @UserId
            LIMIT 1;
            """;

        try
        {
            return await ReadUserProfileAsync(connection, sqlFull, userId, ProfileGapReadMode.Full, cancellationToken);
        }
        catch (Exception ex) when (AsMySqlException(ex) is { } mx && IsUnknownColumnDbError(mx))
        {
            try
            {
                return await ReadUserProfileAsync(
                    connection, sqlDefaultGapOnly, userId, ProfileGapReadMode.DefaultGapOnly, cancellationToken);
            }
            catch (Exception ex2) when (AsMySqlException(ex2) is { } mx2 && IsUnknownColumnDbError(mx2))
            {
                return await ReadUserProfileAsync(connection, sqlLegacy, userId, ProfileGapReadMode.Legacy, cancellationToken);
            }
        }
    }

    private enum ProfileGapReadMode
    {
        Full,
        DefaultGapOnly,
        Legacy,
    }

    private static async Task<UserProfileDto?> ReadUserProfileAsync(
        MySqlConnection connection,
        string sql,
        int userId,
        ProfileGapReadMode mode,
        CancellationToken cancellationToken)
    {
        await using var cmd = new MySqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@UserId", userId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            "user_id", "campus_id", "email", "phone", "lives_on_campus",
            "move_in_date", "move_out_date", "dorm_building", "suite_letter", "avatar_url",
        };

        for (var attempt = 0; attempt < 32; attempt++)
        {
            await using var connection = new MySqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            var sql = $"""
                SELECT {string.Join(", ", columns)}
                FROM users
                WHERE user_id = @UserId
                LIMIT 1;
                """;

            try
            {
                await using var cmd = new MySqlCommand(sql, connection);
                cmd.Parameters.AddWithValue("@UserId", userId);

                await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    return null;
                }

                return MapProfileFromReader(reader);
            }
            catch (Exception ex) when (FindMySqlException(ex) is { } mx && IsBadField(mx) && ParseUnknownColumnName(mx) is { } bad)
            {
                if (!TryRemoveSelectableColumn(columns, bad))
                {
                    throw;
                }
            }
        }

        throw new InvalidOperationException("Could not load profile: too many schema adaptation steps.");
    }

    private static UserProfileDto MapProfileFromReader(MySqlDataReader r)
    {
        var email = r.GetString(ColumnIndex(r, "email"));

        var pi = ColumnIndex(r, "phone");
        var li = ColumnIndex(r, "lives_on_campus");
        var mi = ColumnIndex(r, "move_in_date");
        var mo = ColumnIndex(r, "move_out_date");
        var db = ColumnIndex(r, "dorm_building");
        var sl = ColumnIndex(r, "suite_letter");
        string? suite = null;
        if (sl >= 0 && !r.IsDBNull(sl))
        {
            var s = r.GetString(sl);
            suite = string.IsNullOrWhiteSpace(s) ? null : s.Trim().ToUpperInvariant()[0].ToString();
        }

        string? defaultGap = null;
        string? preferredReceive = null;
        if (mode == ProfileGapReadMode.Full)
        {
            defaultGap = reader.IsDBNull(11) ? null : reader.GetString(11);
            preferredReceive = reader.IsDBNull(12) ? null : reader.GetString(12);
        }
        else if (mode == ProfileGapReadMode.DefaultGapOnly)
        {
            defaultGap = reader.IsDBNull(11) ? null : reader.GetString(11);
        }

        return new UserProfileDto
        {
            UserId = r.GetInt32(ColumnIndex(r, "user_id")),
            CampusId = r.GetInt32(ColumnIndex(r, "campus_id")),
            Email = email,
            DisplayName = DisplayNameFromEmail(email),
            Phone = pi >= 0 && !r.IsDBNull(pi) ? r.GetString(pi) : "",
            LivesOnCampus = li >= 0 && !r.IsDBNull(li) && r.GetBoolean(li),
            MoveInDate = mi >= 0 && !r.IsDBNull(mi) ? r.GetDateTime(mi) : DateTime.UtcNow.Date,
            MoveOutDate = mo >= 0 && !r.IsDBNull(mo) ? r.GetDateTime(mo) : null,
            DormBuilding = db >= 0 && !r.IsDBNull(db) ? r.GetString(db) : null,
            SuiteLetter = suite,
            AvatarUrl = reader.IsDBNull(10) ? null : reader.GetString(10),
            DefaultGapSolution = defaultGap,
            PreferredReceiveGap = preferredReceive,
        };
    }

    /// <summary>Removes a column from SELECT lists; never removes auth/core identifiers.</summary>
    private static bool TryRemoveSelectableColumn(List<string> columns, string unknownColumn)
    {
        var idx = columns.FindIndex(c => string.Equals(c, unknownColumn, StringComparison.OrdinalIgnoreCase));
        if (idx < 0)
        {
            return false;
        }

        if (string.Equals(unknownColumn, "user_id", StringComparison.OrdinalIgnoreCase)
            || string.Equals(unknownColumn, "campus_id", StringComparison.OrdinalIgnoreCase)
            || string.Equals(unknownColumn, "email", StringComparison.OrdinalIgnoreCase)
            || string.Equals(unknownColumn, "password_hash", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        columns.RemoveAt(idx);
        return true;
    }

    public async Task<bool> UpdateProfileAsync(int userId, UpdateUserProfileRequest request, CancellationToken cancellationToken = default)
    {
        var setColumns = new List<string>
        {
            "display_name", "phone", "lives_on_campus", "move_in_date", "move_out_date", "dorm_building", "suite_letter", "avatar_url",
        };

        const string sqlFull = """
            UPDATE users
            SET display_name = @DisplayName,
                phone = @Phone,
                lives_on_campus = @LivesOnCampus,
                move_in_date = @MoveInDate,
                move_out_date = @MoveOutDate,
                dorm_building = @DormBuilding,
                suite_letter = @SuiteLetter,
                avatar_url = @AvatarUrl,
                default_gap_solution = @DefaultGapSolution,
                preferred_receive_gap = @PreferredReceiveGap
            WHERE user_id = @UserId;
            """;

        const string sqlDefaultGapOnly = """
            UPDATE users
            SET display_name = @DisplayName,
                phone = @Phone,
                lives_on_campus = @LivesOnCampus,
                move_in_date = @MoveInDate,
                move_out_date = @MoveOutDate,
                dorm_building = @DormBuilding,
                suite_letter = @SuiteLetter,
                avatar_url = @AvatarUrl,
                default_gap_solution = @DefaultGapSolution
            WHERE user_id = @UserId;
            """;

        const string sqlLegacy = """
            UPDATE users
            SET display_name = @DisplayName,
                phone = @Phone,
                lives_on_campus = @LivesOnCampus,
                move_in_date = @MoveInDate,
                move_out_date = @MoveOutDate,
                dorm_building = @DormBuilding,
                suite_letter = @SuiteLetter,
                avatar_url = @AvatarUrl
            WHERE user_id = @UserId;
            """;

        try
        {
            return await ExecuteUserProfileUpdateAsync(connection, sqlFull, userId, request, ProfileGapWriteMode.Full, cancellationToken);
        }
        catch (Exception ex) when (AsMySqlException(ex) is { } mx && IsUnknownColumnDbError(mx))
        {
            try
            {
                return await ExecuteUserProfileUpdateAsync(
                    connection, sqlDefaultGapOnly, userId, request, ProfileGapWriteMode.DefaultGapOnly, cancellationToken);
            }
            catch (Exception ex2) when (AsMySqlException(ex2) is { } mx2 && IsUnknownColumnDbError(mx2))
            {
                return await ExecuteUserProfileUpdateAsync(
                    connection, sqlLegacy, userId, request, ProfileGapWriteMode.Legacy, cancellationToken);
            }
        }
    }

    private enum ProfileGapWriteMode
    {
        Full,
        DefaultGapOnly,
        Legacy,
    }

    private static async Task<bool> ExecuteUserProfileUpdateAsync(
        MySqlConnection connection,
        string sql,
        int userId,
        UpdateUserProfileRequest request,
        ProfileGapWriteMode mode,
        CancellationToken cancellationToken)
    {
        await using var cmd = new MySqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@UserId", userId);
        cmd.Parameters.AddWithValue("@DisplayName", request.DisplayName.Trim());
        cmd.Parameters.AddWithValue("@Phone", request.Phone.Trim());
        cmd.Parameters.AddWithValue("@LivesOnCampus", request.LivesOnCampus);
        cmd.Parameters.AddWithValue("@MoveInDate", DateTime.Parse(request.MoveInDate).Date);
        cmd.Parameters.AddWithValue("@MoveOutDate", string.IsNullOrWhiteSpace(request.MoveOutDate) ? DBNull.Value : DateTime.Parse(request.MoveOutDate!).Date);
        cmd.Parameters.AddWithValue("@DormBuilding", string.IsNullOrWhiteSpace(request.DormBuilding) ? DBNull.Value : request.DormBuilding.Trim());
        cmd.Parameters.AddWithValue("@SuiteLetter", string.IsNullOrWhiteSpace(request.SuiteLetter) ? DBNull.Value : request.SuiteLetter.Trim().ToUpperInvariant()[0].ToString());
        cmd.Parameters.Add(
            new MySqlParameter("@AvatarUrl", MySqlDbType.LongText)
            {
                Value = string.IsNullOrWhiteSpace(request.AvatarUrl) ? DBNull.Value : request.AvatarUrl.Trim(),
            });
        if (mode != ProfileGapWriteMode.Legacy)
        {
            cmd.Parameters.AddWithValue(
                "@DefaultGapSolution",
                string.IsNullOrWhiteSpace(request.DefaultGapSolution) ? DBNull.Value : request.DefaultGapSolution.Trim());
        }

        if (mode == ProfileGapWriteMode.Full)
        {
            cmd.Parameters.AddWithValue(
                "@PreferredReceiveGap",
                string.IsNullOrWhiteSpace(request.PreferredReceiveGap) ? DBNull.Value : request.PreferredReceiveGap.Trim());
        }

            await using var connection = new MySqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            var setClause = string.Join(", ", setColumns.Select(c => $"{c} = {ToUpdateParamName(c)}"));
            var sql = $"""
                UPDATE users
                SET {setClause}
                WHERE user_id = @UserId;
                """;

            try
            {
                await using var cmd = new MySqlCommand(sql, connection);
                cmd.Parameters.AddWithValue("@UserId", userId);
                AddUpdateParameters(cmd, setColumns, request);
                var rows = await cmd.ExecuteNonQueryAsync(cancellationToken);
                return rows > 0;
            }
            catch (Exception ex) when (FindMySqlException(ex) is { } umx && IsBadField(umx) && ParseUnknownColumnName(umx) is { } bad)
            {
                var i = setColumns.FindIndex(c => string.Equals(c, bad, StringComparison.OrdinalIgnoreCase));
                if (i < 0)
                {
                    throw;
                }

                setColumns.RemoveAt(i);
            }
        }

        return false;
    }

    private static string ToUpdateParamName(string column) => column switch
    {
        "display_name" => "@DisplayName",
        "phone" => "@Phone",
        "lives_on_campus" => "@LivesOnCampus",
        "move_in_date" => "@MoveInDate",
        "move_out_date" => "@MoveOutDate",
        "dorm_building" => "@DormBuilding",
        "suite_letter" => "@SuiteLetter",
        "avatar_url" => "@AvatarUrl",
        _ => throw new ArgumentOutOfRangeException(nameof(column), column, null),
    };

    private static void AddUpdateParameters(MySqlCommand cmd, List<string> setColumns, UpdateUserProfileRequest request)
    {
        foreach (var c in setColumns)
        {
            switch (c)
            {
                case "display_name":
                    cmd.Parameters.AddWithValue("@DisplayName", request.DisplayName.Trim());
                    break;
                case "phone":
                    cmd.Parameters.AddWithValue("@Phone", request.Phone.Trim());
                    break;
                case "lives_on_campus":
                    cmd.Parameters.AddWithValue("@LivesOnCampus", request.LivesOnCampus);
                    break;
                case "move_in_date":
                    cmd.Parameters.AddWithValue("@MoveInDate", DateTime.Parse(request.MoveInDate).Date);
                    break;
                case "move_out_date":
                    cmd.Parameters.AddWithValue(
                        "@MoveOutDate",
                        string.IsNullOrWhiteSpace(request.MoveOutDate) ? DBNull.Value : DateTime.Parse(request.MoveOutDate!).Date);
                    break;
                case "dorm_building":
                    cmd.Parameters.AddWithValue(
                        "@DormBuilding",
                        string.IsNullOrWhiteSpace(request.DormBuilding) ? DBNull.Value : request.DormBuilding.Trim());
                    break;
                case "suite_letter":
                    cmd.Parameters.AddWithValue(
                        "@SuiteLetter",
                        string.IsNullOrWhiteSpace(request.SuiteLetter) ? DBNull.Value : request.SuiteLetter.Trim().ToUpperInvariant()[0].ToString());
                    break;
                case "avatar_url":
                    cmd.Parameters.Add(
                        new MySqlParameter("@AvatarUrl", MySqlDbType.LongText)
                        {
                            Value = string.IsNullOrWhiteSpace(request.AvatarUrl) ? DBNull.Value : request.AvatarUrl.Trim(),
                        });
                    break;
            }
        }
    }

    /// <summary>Returns new user id, or null if email already exists.</summary>
    public async Task<int?> TryCreateAsync(
        string email,
        string passwordHash,
        string phone,
        bool livesOnCampus,
        DateTime moveDate,
        DateTime moveOutDate,
        string? dormBuilding,
        char? suiteLetter,
        string? defaultGapSolution)
    {
        var normalizedEmail = email.Trim().ToLowerInvariant();
        var displayName = DisplayNameFromEmail(normalizedEmail);

        await using var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync();

        var campusId = await GetDefaultCampusIdAsync(connection);

        const string insertSqlWithGap = """
            INSERT INTO users (
                campus_id, email, password_hash, display_name, phone, lives_on_campus,
                move_in_date, move_out_date, dorm_building, suite_letter, default_gap_solution
            )
            VALUES (
                @CampusId, @Email, @PasswordHash, @DisplayName, @Phone, @LivesOnCampus,
                @MoveInDate, @MoveOutDate, @DormBuilding, @SuiteLetter, @DefaultGapSolution
            );
            """;

        const string insertSqlLegacy = """
            INSERT INTO users (
                campus_id, email, password_hash, display_name, phone, lives_on_campus,
                move_in_date, move_out_date, dorm_building, suite_letter
            )
            VALUES (
                @CampusId, @Email, @PasswordHash, @DisplayName, @Phone, @LivesOnCampus,
                @MoveInDate, @MoveOutDate, @DormBuilding, @SuiteLetter
            );
            """;

        async Task<bool> TryInsertAsync(string sql, bool includeDefaultGap)
        {
            await using var command = new MySqlCommand(sql, connection);
            command.Parameters.AddWithValue("@CampusId", campusId);
            command.Parameters.AddWithValue("@Email", normalizedEmail);
            command.Parameters.AddWithValue("@PasswordHash", passwordHash);
            command.Parameters.AddWithValue("@DisplayName", displayName);
            command.Parameters.AddWithValue("@Phone", phone.Trim());
            command.Parameters.AddWithValue("@LivesOnCampus", livesOnCampus);
            command.Parameters.AddWithValue("@MoveInDate", moveDate.Date);
            command.Parameters.AddWithValue("@MoveOutDate", moveOutDate.Date);
            command.Parameters.AddWithValue("@DormBuilding", string.IsNullOrWhiteSpace(dormBuilding) ? DBNull.Value : dormBuilding.Trim());
            if (suiteLetter is null)
            {
                command.Parameters.AddWithValue("@SuiteLetter", DBNull.Value);
            }
            else
            {
                command.Parameters.AddWithValue("@SuiteLetter", suiteLetter.Value.ToString());
            }

            if (includeDefaultGap)
            {
                command.Parameters.AddWithValue(
                    "@DefaultGapSolution",
                    string.IsNullOrWhiteSpace(defaultGapSolution) ? DBNull.Value : defaultGapSolution.Trim());
            }

            try
            {
                await command.ExecuteNonQueryAsync();
                return true;
            }
            catch (Exception ex)
            {
                return false;
            }
        }

        try
        {
            if (!await TryInsertAsync(insertSqlWithGap, includeDefaultGap: true))
            {
                return null;
            }
        }
        catch (MySqlException ex) when (IsUnknownColumnDbError(ex))
        {
            if (!await TryInsertAsync(insertSqlLegacy, includeDefaultGap: false))
            {
                return null;
            }
        }

        throw new InvalidOperationException("Could not insert user: too many schema adaptation steps.");
    }

    private static void InsertDisplayNameAfterPasswordHash(List<string> columns)
    {
        if (columns.Any(c => string.Equals(c, "display_name", StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }

        var i = columns.FindIndex(c => string.Equals(c, "password_hash", StringComparison.OrdinalIgnoreCase));
        if (i < 0)
        {
            columns.Insert(2, "display_name");
        }
        else
        {
            columns.Insert(i + 1, "display_name");
        }
    }

    private static bool TryRemoveInsertableColumn(List<string> columns, string unknownColumn)
    {
        var idx = columns.FindIndex(c => string.Equals(c, unknownColumn, StringComparison.OrdinalIgnoreCase));
        if (idx < 0)
        {
            return false;
        }

        if (string.Equals(unknownColumn, "campus_id", StringComparison.OrdinalIgnoreCase)
            || string.Equals(unknownColumn, "email", StringComparison.OrdinalIgnoreCase)
            || string.Equals(unknownColumn, "password_hash", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        columns.RemoveAt(idx);
        return columns.Count >= 3;
    }

    private static string ToInsertParamName(string column) => column switch
    {
        "campus_id" => "@CampusId",
        "email" => "@Email",
        "password_hash" => "@PasswordHash",
        "display_name" => "@DisplayName",
        "phone" => "@Phone",
        "lives_on_campus" => "@LivesOnCampus",
        "move_in_date" => "@MoveInDate",
        "move_out_date" => "@MoveOutDate",
        "dorm_building" => "@DormBuilding",
        "suite_letter" => "@SuiteLetter",
        _ => throw new ArgumentOutOfRangeException(nameof(column), column, null),
    };

    private static void AddInsertParameters(
        MySqlCommand cmd,
        List<string> columns,
        int campusId,
        string normalizedEmail,
        string passwordHash,
        string displayName,
        string phone,
        bool livesOnCampus,
        DateTime moveDate,
        DateTime moveOutDate,
        string? dormBuilding,
        char? suiteLetter)
    {
        foreach (var c in columns)
        {
            switch (c)
            {
                case "campus_id":
                    cmd.Parameters.AddWithValue("@CampusId", campusId);
                    break;
                case "email":
                    cmd.Parameters.AddWithValue("@Email", normalizedEmail);
                    break;
                case "password_hash":
                    cmd.Parameters.AddWithValue("@PasswordHash", passwordHash);
                    break;
                case "display_name":
                    cmd.Parameters.AddWithValue("@DisplayName", displayName);
                    break;
                case "phone":
                    cmd.Parameters.AddWithValue("@Phone", phone.Trim());
                    break;
                case "lives_on_campus":
                    cmd.Parameters.AddWithValue("@LivesOnCampus", livesOnCampus);
                    break;
                case "move_in_date":
                    cmd.Parameters.AddWithValue("@MoveInDate", moveDate.Date);
                    break;
                case "move_out_date":
                    cmd.Parameters.AddWithValue("@MoveOutDate", moveOutDate.Date);
                    break;
                case "dorm_building":
                    cmd.Parameters.AddWithValue("@DormBuilding", string.IsNullOrWhiteSpace(dormBuilding) ? DBNull.Value : dormBuilding.Trim());
                    break;
                case "suite_letter":
                    if (suiteLetter is null)
                    {
                        cmd.Parameters.AddWithValue("@SuiteLetter", DBNull.Value);
                    }
                    else
                    {
                        cmd.Parameters.AddWithValue("@SuiteLetter", suiteLetter.Value.ToString());
                    }

                    break;
            }
        }
    }

    private static async Task<int> ReadLastInsertIdAsync(MySqlConnection connection)
    {
        await using var idCmd = new MySqlCommand("SELECT LAST_INSERT_ID();", connection);
        var scalar = await idCmd.ExecuteScalarAsync();
        return Convert.ToInt32(scalar);
    }
}
