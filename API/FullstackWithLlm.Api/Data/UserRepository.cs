using FullstackWithLlm.Api.Models;
using MySqlConnector;

namespace FullstackWithLlm.Api.Data;

public sealed class UserRepository
{
    private readonly string _connectionString;

    private static async Task EnsureUsersTableAsync(MySqlConnection connection)
    {
        const string sql = """
            CREATE TABLE IF NOT EXISTS Users
            (
                Id INT NOT NULL AUTO_INCREMENT,
                Email VARCHAR(255) NOT NULL,
                PasswordHash VARCHAR(255) NOT NULL,
                Phone VARCHAR(40) NOT NULL,
                LivesOnCampus TINYINT(1) NOT NULL,
                MoveDate DATE NOT NULL,
                MoveOutDate DATE NULL,
                DormBuilding VARCHAR(120) NULL,
                SuiteLetter CHAR(1) NULL,
                CreatedAtUtc DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                PRIMARY KEY (Id),
                UNIQUE KEY UX_Users_Email (Email)
            );
            """;

        await using var cmd = new MySqlCommand(sql, connection);
        await cmd.ExecuteNonQueryAsync();

        // If Users was created previously without MoveOutDate, add it without failing.
        const string checkSql = """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'Users'
              AND column_name = 'MoveOutDate';
            """;

        await using var checkCmd = new MySqlCommand(checkSql, connection);
        var countObj = await checkCmd.ExecuteScalarAsync();
        var count = Convert.ToInt32(countObj);

        if (count == 0)
        {
            const string alterSql = "ALTER TABLE Users ADD COLUMN MoveOutDate DATE NULL;";
            await using var alterCmd = new MySqlCommand(alterSql, connection);
            await alterCmd.ExecuteNonQueryAsync();
        }
    }

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

    public async Task<User?> GetByEmailAsync(string email)
    {
        var normalized = email.Trim().ToLowerInvariant();

        await using var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync();
        await EnsureUsersTableAsync(connection);

        const string sql = """
            SELECT Id, Email, PasswordHash, Phone, LivesOnCampus, MoveDate, MoveOutDate, DormBuilding, SuiteLetter
            FROM Users
            WHERE Email = @Email
            LIMIT 1;
            """;

        await using var command = new MySqlCommand(sql, connection);
        command.Parameters.AddWithValue("@Email", normalized);

        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        string? dorm = reader.IsDBNull(7) ? null : reader.GetString(7);
        char? suite = null;
        if (!reader.IsDBNull(8))
        {
            var s = reader.GetString(8);
            if (s.Length > 0)
            {
                suite = char.ToUpperInvariant(s[0]);
            }
        }

        return new User
        {
            Id = reader.GetInt32(0),
            Email = reader.GetString(1),
            PasswordHash = reader.GetString(2),
            Phone = reader.GetString(3),
            LivesOnCampus = reader.GetBoolean(4),
            MoveDate = reader.GetDateTime(5),
            MoveOutDate = reader.IsDBNull(6) ? null : reader.GetDateTime(6),
            DormBuilding = reader.IsDBNull(7) ? null : reader.GetString(7),
            SuiteLetter = suite,
        };
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

        await using var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync();
        await EnsureUsersTableAsync(connection);

        const string insertSql = """
            INSERT INTO Users (Email, PasswordHash, Phone, LivesOnCampus, MoveDate, MoveOutDate, DormBuilding, SuiteLetter)
            VALUES (@Email, @PasswordHash, @Phone, @LivesOnCampus, @MoveDate, @MoveOutDate, @DormBuilding, @SuiteLetter);
            """;

        await using (var command = new MySqlCommand(insertSql, connection))
        {
            command.Parameters.AddWithValue("@Email", normalizedEmail);
            command.Parameters.AddWithValue("@PasswordHash", passwordHash);
            command.Parameters.AddWithValue("@Phone", phone.Trim());
            command.Parameters.AddWithValue("@LivesOnCampus", livesOnCampus);
            command.Parameters.AddWithValue("@MoveDate", moveDate.Date);
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
