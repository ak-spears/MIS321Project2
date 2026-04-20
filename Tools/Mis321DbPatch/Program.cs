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

LoadEnvFromUpwards();
var cs = args.Length > 0 && !string.IsNullOrWhiteSpace(args[0]) ? args[0].Trim() : ResolveConnectionString();
if (string.IsNullOrWhiteSpace(cs))
{
    Console.Error.WriteLine(
        "No connection string. Set ConnectionStrings__DefaultConnection or DATABASE_URL, " +
        "or add a .env in this repo (or parent folders) with one of those keys.");
    return 2;
}

try
{
    await using var conn = new MySqlConnection(cs);
    await conn.OpenAsync();

    const string checkSql = """
        SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'listings' AND COLUMN_NAME = 'image_url'
        """;
    await using (var check = new MySqlCommand(checkSql, conn))
    {
        var n = Convert.ToInt32(await check.ExecuteScalarAsync());
        if (n > 0)
        {
            Console.WriteLine("listings.image_url already exists — nothing to do.");
            return 0;
        }
    }

    await using (var alter = new MySqlCommand(
                       "ALTER TABLE listings ADD COLUMN image_url MEDIUMTEXT NULL",
                       conn))
    {
        await alter.ExecuteNonQueryAsync();
    }

    Console.WriteLine("Added listings.image_url (MEDIUMTEXT NULL).");
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex.Message);
    return 1;
}
