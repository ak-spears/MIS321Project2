using FullstackWithLlm.Api.Models;
using MySqlConnector;

namespace FullstackWithLlm.Api.Data;

public sealed class UserRepository
{
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

        await using var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync();

        // Match case-insensitive + trimmed so logins work even if legacy rows mixed email casing.
        const string sql = """
            SELECT user_id, campus_id, email, password_hash, display_name, phone, lives_on_campus,
                   move_in_date, move_out_date, dorm_building, suite_letter
            FROM users
            WHERE LOWER(TRIM(email)) = @Email
            LIMIT 1;
            """;

        await using var command = new MySqlCommand(sql, connection);
        command.Parameters.AddWithValue("@Email", normalized);

        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        string? dorm = reader.IsDBNull(9) ? null : reader.GetString(9);
        char? suite = null;
        if (!reader.IsDBNull(10))
        {
            var s = reader.GetString(10);
            if (s.Length > 0)
            {
                suite = char.ToUpperInvariant(s[0]);
            }
        }

        return new User
        {
            Id = reader.GetInt32(0),
            CampusId = reader.GetInt32(1),
            Email = reader.GetString(2),
            PasswordHash = reader.GetString(3),
            DisplayName = reader.GetString(4),
            Phone = reader.GetString(5),
            LivesOnCampus = reader.GetBoolean(6),
            MoveDate = reader.GetDateTime(7),
            MoveOutDate = reader.IsDBNull(8) ? null : reader.GetDateTime(8),
            DormBuilding = dorm,
            SuiteLetter = suite,
        };
    }

    public async Task<UserProfileDto?> GetProfileByIdAsync(int userId, CancellationToken cancellationToken = default)
    {
        await using var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);

        const string sql = """
            SELECT user_id, campus_id, email, display_name, phone, lives_on_campus,
                   move_in_date, move_out_date, dorm_building, suite_letter, avatar_url
            FROM users
            WHERE user_id = @UserId
            LIMIT 1;
            """;

        await using var cmd = new MySqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@UserId", userId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        string? suite = null;
        if (!reader.IsDBNull(9))
        {
            var s = reader.GetString(9);
            suite = string.IsNullOrWhiteSpace(s) ? null : s.Trim().ToUpperInvariant()[0].ToString();
        }

        return new UserProfileDto
        {
            UserId = reader.GetInt32(0),
            CampusId = reader.GetInt32(1),
            Email = reader.GetString(2),
            DisplayName = reader.GetString(3),
            Phone = reader.GetString(4),
            LivesOnCampus = reader.GetBoolean(5),
            MoveInDate = reader.GetDateTime(6),
            MoveOutDate = reader.IsDBNull(7) ? null : reader.GetDateTime(7),
            DormBuilding = reader.IsDBNull(8) ? null : reader.GetString(8),
            SuiteLetter = suite,
            AvatarUrl = reader.IsDBNull(10) ? null : reader.GetString(10),
        };
    }

    public async Task<bool> UpdateProfileAsync(int userId, UpdateUserProfileRequest request, CancellationToken cancellationToken = default)
    {
        await using var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);

        const string sql = """
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

        var rows = await cmd.ExecuteNonQueryAsync(cancellationToken);
        return rows > 0;
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

        await using var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync();

        var campusId = await GetDefaultCampusIdAsync(connection);

        const string insertSql = """
            INSERT INTO users (
                campus_id, email, password_hash, display_name, phone, lives_on_campus,
                move_in_date, move_out_date, dorm_building, suite_letter
            )
            VALUES (
                @CampusId, @Email, @PasswordHash, @DisplayName, @Phone, @LivesOnCampus,
                @MoveInDate, @MoveOutDate, @DormBuilding, @SuiteLetter
            );
            """;

        await using (var command = new MySqlCommand(insertSql, connection))
        {
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

            try
            {
                await command.ExecuteNonQueryAsync();
            }
            catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
            {
                return null;
            }
        }

        await using var idCmd = new MySqlCommand("SELECT LAST_INSERT_ID();", connection);
        var scalar = await idCmd.ExecuteScalarAsync();
        return Convert.ToInt32(scalar);
    }
}
