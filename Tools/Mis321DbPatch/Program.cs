using System.Text;
using MySqlConnector;

static void LoadEnvFromUpwards(string envFileName = ".env", int maxLevels = 12)
{
    var dir = Directory.GetCurrentDirectory();
    for (var i = 0; i < maxLevels && !string.IsNullOrWhiteSpace(dir); i++)
    {
        var path = Path.Combine(dir, envFileName);
        if (File.Exists(path))
        {
            foreach (var raw in File.ReadAllLines(path))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith('#')) continue;
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                var key = line[..eq].Trim();
                var val = line[(eq + 1)..].Trim();
                if ((val.StartsWith('"') && val.EndsWith('"')) || (val.StartsWith('\'') && val.EndsWith('\'')))
                    val = val[1..^1];
                if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(key)))
                    Environment.SetEnvironmentVariable(key, val);
            }

            return;
        }

        dir = Directory.GetParent(dir)?.FullName ?? "";
    }
}

static string? TryMysqlUrlToConnectionString(string? raw)
{
    if (string.IsNullOrWhiteSpace(raw)) return null;
    raw = raw.Trim();
    if (!raw.StartsWith("mysql://", StringComparison.OrdinalIgnoreCase)) return null;
    var remainder = raw["mysql://".Length..];
    if (string.IsNullOrEmpty(remainder)) return null;
    if (!Uri.TryCreate("http://" + remainder, UriKind.Absolute, out var uri)) return null;
    var userInfo = uri.UserInfo;
    if (string.IsNullOrEmpty(userInfo)) return null;
    string user;
    string password;
    var colon = userInfo.IndexOf(':');
    if (colon < 0)
    {
        user = Uri.UnescapeDataString(userInfo);
        password = "";
    }
    else
    {
        user = Uri.UnescapeDataString(userInfo[..colon]);
        password = Uri.UnescapeDataString(userInfo[(colon + 1)..]);
    }

    var host = uri.Host;
    var port = uri.Port > 0 ? uri.Port : 3306;
    var db = uri.AbsolutePath.TrimStart('/');
    if (string.IsNullOrEmpty(db)) return null;
    var sb = new StringBuilder();
    sb.Append("Server=").Append(host).Append(';');
    sb.Append("Port=").Append(port).Append(';');
    sb.Append("Database=").Append(db).Append(';');
    sb.Append("User Id=").Append(user).Append(';');
    sb.Append("Password=").Append(password).Append(';');
    sb.Append("SslMode=").Append(host is "localhost" or "127.0.0.1" ? "None" : "Required");
    sb.Append(';');
    return sb.ToString();
}

static string? ResolveConnectionString()
{
    var direct = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");
    if (!string.IsNullOrWhiteSpace(direct)) return direct.Trim();

    foreach (var key in new[] { "DATABASE_URL", "JAWSDB_URL", "JAWSDB_MARIA_URL", "CLEARDB_DATABASE_URL", "MYSQL_URL" })
    {
        var parsed = TryMysqlUrlToConnectionString(Environment.GetEnvironmentVariable(key));
        if (!string.IsNullOrWhiteSpace(parsed)) return parsed;
    }

    return null;
}

/// <summary>Runs a .sql file (e.g. catchup) using the same user variables + PREPARE pattern as MySQL Workbench.</summary>
static int RunSqlFile(string filePath, string connectionString)
{
    var full = Path.GetFullPath(filePath);
    if (!File.Exists(full))
    {
        Console.Error.WriteLine("File not found: " + full);
        return 2;
    }

    var sql = File.ReadAllText(full);
    var b = new MySqlConnectionStringBuilder(connectionString) { AllowUserVariables = true };
    using var conn = new MySqlConnection(b.ConnectionString);
    conn.Open();
    // Send whole script: server must accept multiple statements in one query (default for MySQL 8+ / connector).
    using var cmd = new MySqlCommand(sql, conn) { CommandTimeout = 0 };
    cmd.ExecuteNonQuery();
    Console.WriteLine("OK: " + full);
    return 0;
}

static int RunImageUrlOnlyPatch(string connectionString)
{
    using var conn = new MySqlConnection(connectionString);
    conn.Open();

    const string checkSql = """
        SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'listings' AND COLUMN_NAME = 'image_url'
        """;
    using (var check = new MySqlCommand(checkSql, conn))
    {
        var n = Convert.ToInt32(check.ExecuteScalar());
        if (n > 0)
        {
            Console.WriteLine("listings.image_url already exists — nothing to do.");
            return 0;
        }
    }

    using (var alter = new MySqlCommand(
               "ALTER TABLE listings ADD COLUMN image_url MEDIUMTEXT NULL",
               conn))
    {
        alter.ExecuteNonQuery();
    }

    Console.WriteLine("Added listings.image_url (MEDIUMTEXT NULL).");
    return 0;
}

LoadEnvFromUpwards();

// dotnet run --project Tools/Mis321DbPatch -- path\to\catchup_api_schema_idempotent.sql
// (run from repo root; uses .env DATABASE_URL)
string? connectionString;
string? sqlPath = null;

if (args.Length > 0 && !string.IsNullOrWhiteSpace(args[0]))
{
    var a0 = args[0].Trim();
    if (a0.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
    {
        var candidate = File.Exists(a0) ? a0 : Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), a0));
        if (File.Exists(candidate)) sqlPath = candidate;
    }

    if (sqlPath != null)
    {
        connectionString = args.Length > 1 && !string.IsNullOrWhiteSpace(args[1]) ? args[1].Trim() : ResolveConnectionString();
    }
    else
    {
        connectionString = a0;
    }
}
else
{
    connectionString = ResolveConnectionString();
}

if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine(
        "No connection string. Set ConnectionStrings__DefaultConnection or DATABASE_URL, " +
        "or add a .env in the repo with one of those keys.");
    return 2;
}

try
{
    if (sqlPath != null) return RunSqlFile(sqlPath, connectionString);
    return RunImageUrlOnlyPatch(connectionString);
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex.Message);
    return 1;
}
