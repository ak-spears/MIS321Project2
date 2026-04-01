using Microsoft.Extensions.Configuration;

namespace FullstackWithLlm.Api;

/// <summary>
/// Maps Heroku-style <c>mysql://user:pass@host:port/db</c> env vars to a MySqlConnector connection string
/// when <see cref="ConnectionStrings:DefaultConnection"/> is not set.
/// </summary>
internal static class DatabaseUrlResolver
{
    private static readonly string[] HerokuMysqlEnvKeys =
    [
        "DATABASE_URL",
        "JAWSDB_URL",
        "JAWSDB_MARIA_URL",
        "CLEARDB_DATABASE_URL",
        "MYSQL_URL",
    ];

    public static void ApplyIfNeeded(ConfigurationManager configuration)
    {
        var current = configuration.GetConnectionString("DefaultConnection");
        if (!string.IsNullOrWhiteSpace(current))
        {
            return;
        }

        foreach (var key in HerokuMysqlEnvKeys)
        {
            var raw = Environment.GetEnvironmentVariable(key);
            var parsed = TryParseMysqlUrl(raw);
            if (!string.IsNullOrWhiteSpace(parsed))
            {
                configuration.AddInMemoryCollection(
                    new Dictionary<string, string?> { ["ConnectionStrings:DefaultConnection"] = parsed });
                return;
            }
        }
    }

    internal static string? TryParseMysqlUrl(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        raw = raw.Trim();
        if (!raw.StartsWith("mysql://", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        try
        {
            var remainder = raw["mysql://".Length..];
            if (string.IsNullOrEmpty(remainder))
            {
                return null;
            }

            // Uri does not parse mysql: scheme reliably; use http for structured parts only.
            if (!Uri.TryCreate("http://" + remainder, UriKind.Absolute, out var uri))
            {
                return null;
            }

            var userInfo = uri.UserInfo;
            if (string.IsNullOrEmpty(userInfo))
            {
                return null;
            }

            var colon = userInfo.IndexOf(':');
            string user;
            string password;
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
            if (string.IsNullOrEmpty(host))
            {
                return null;
            }

            var port = uri.Port > 0 ? uri.Port : 3306;
            var db = uri.AbsolutePath.TrimStart('/').Split('?')[0];
            if (string.IsNullOrEmpty(db))
            {
                return null;
            }

            return $"Server={host};Port={port};Database={db};User Id={user};Password={password};SslMode=Required;";
        }
        catch
        {
            return null;
        }
    }
}
