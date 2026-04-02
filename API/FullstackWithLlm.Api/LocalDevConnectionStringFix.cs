using MySqlConnector;

namespace FullstackWithLlm.Api;

/// <summary>
/// In Development, bumps MySQL connect timeout (default 15s). Slow TLS or WAN paths may need longer.
/// Does not fix blocked RDS security groups, "Public access = No", or wrong credentials.
/// </summary>
internal static class LocalDevConnectionStringFix
{
    public static void Apply(WebApplicationBuilder builder)
    {
        if (!builder.Environment.IsDevelopment())
        {
            return;
        }

        var raw = builder.Configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(raw))
        {
            return;
        }

        try
        {
            var csb = new MySqlConnectionStringBuilder(raw);
            if (csb.ConnectionTimeout < 60u)
            {
                csb.ConnectionTimeout = 60u;
            }

            builder.Configuration.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:DefaultConnection"] = csb.ConnectionString,
                });
        }
        catch (ArgumentException)
        {
            // Malformed string; repositories will fail with a clearer error on connect.
        }
    }
}
