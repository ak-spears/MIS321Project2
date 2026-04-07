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
        var columns = new List<string>
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

        var av = ColumnIndex(r, "avatar_url");

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
            AvatarUrl = av >= 0 && !r.IsDBNull(av) ? r.GetString(av) : null,
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

        for (var attempt = 0; attempt < 32; attempt++)
        {
            if (setColumns.Count == 0)
            {
                return false;
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
        char? suiteLetter)
    {
        var normalizedEmail = email.Trim().ToLowerInvariant();
        var displayName = DisplayNameFromEmail(normalizedEmail);

        var columns = new List<string>
        {
            "campus_id", "email", "password_hash", "phone", "lives_on_campus",
            "move_in_date", "move_out_date", "dorm_building", "suite_letter",
        };

        for (var attempt = 0; attempt < 40; attempt++)
        {
            await using var connection = new MySqlConnection(_connectionString);
            await connection.OpenAsync();

            var campusId = await GetDefaultCampusIdAsync(connection);

            var colList = string.Join(", ", columns);
            var placeholders = string.Join(", ", columns.Select(ToInsertParamName));
            var sql = $"INSERT INTO users ({colList}) VALUES ({placeholders});";

            try
            {
                await using var cmd = new MySqlCommand(sql, connection);
                AddInsertParameters(cmd, columns, campusId, normalizedEmail, passwordHash, displayName, phone, livesOnCampus, moveDate, moveOutDate, dormBuilding, suiteLetter);
                await cmd.ExecuteNonQueryAsync();
                return await ReadLastInsertIdAsync(connection);
            }
            catch (Exception ex)
            {
                var mx = FindMySqlException(ex);
                if (IsDuplicateKey(mx))
                {
                    return null;
                }

                if (IsNoDefaultForField(mx) && MissingFieldHint(mx, "display_name"))
                {
                    InsertDisplayNameAfterPasswordHash(columns);
                    continue;
                }

                if (IsBadField(mx) && ParseUnknownColumnName(mx!) is { } bad && TryRemoveInsertableColumn(columns, bad))
                {
                    continue;
                }

                throw;
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
