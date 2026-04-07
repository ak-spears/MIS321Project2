using System.Text;
using FullstackWithLlm.Api;
using FullstackWithLlm.Api.Data;
using FullstackWithLlm.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using MySqlConnector;
using System.Text.Json;

EnvLoader.LoadLocalEnvFromUpwards(".env");

var builder = WebApplication.CreateBuilder(args);

// Heroku add-ons often expose mysql:// only as DATABASE_URL / JAWSDB_URL; .env can mirror that for local dotnet run.
DatabaseUrlResolver.ApplyIfNeeded(builder.Configuration);
LocalDevConnectionStringFix.Apply(builder);

builder.Services.AddControllers().AddJsonOptions(o =>
{
    o.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    // POST bodies from the SPA use camelCase; bind even if casing drifts.
    o.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
});
builder.Services.AddScoped<ProductRepository>();
builder.Services.AddScoped<UserRepository>();
builder.Services.AddScoped<ListingRepository>();
builder.Services.AddScoped<TransactionRepository>();
builder.Services.AddSingleton<JwtTokenService>();

var jwtKey = builder.Configuration["Jwt:SigningKey"];
if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32)
{
    throw new InvalidOperationException(
        "Jwt:SigningKey must be set (32+ chars). Use Jwt__SigningKey in .env or appsettings.");
}

var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "FullstackWithLlm.Api";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "CampusDormMarketplace";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(2),
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        policy
            // Your browser sends `Origin: null` when `index.html` is opened directly (file://...).
            // Accept that in dev so fetch() and preflights succeed.
            .SetIsOriginAllowed(origin =>
            {
                if (string.IsNullOrWhiteSpace(origin) || origin.Equals("null", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }

                if (Uri.TryCreate(origin, UriKind.Absolute, out var u) &&
                    u.Host.EndsWith(".herokuapp.com", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }

                return origin.Equals("http://127.0.0.1:5500", StringComparison.OrdinalIgnoreCase) ||
                       origin.Equals("http://localhost:5500", StringComparison.OrdinalIgnoreCase) ||
                       origin.Equals("http://127.0.0.1:5147", StringComparison.OrdinalIgnoreCase) ||
                       origin.Equals("http://localhost:5147", StringComparison.OrdinalIgnoreCase) ||
                       origin.Equals("http://127.0.0.1:5148", StringComparison.OrdinalIgnoreCase) ||
                       origin.Equals("http://localhost:5148", StringComparison.OrdinalIgnoreCase);
            })
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        var feature = context.Features.Get<IExceptionHandlerFeature>();
        var ex = feature?.Error;

        static MySqlException? FindMySqlException(Exception? e)
        {
            for (; e != null; e = e.InnerException)
            {
                if (e is MySqlException mx)
                {
                    return mx;
                }
            }

            return null;
        }

        if (FindMySqlException(ex) is { } mx)
        {
            // BadFieldError = unknown column / schema drift — not a connection outage.
            if (mx.ErrorCode == MySqlErrorCode.BadFieldError || mx.Number == 1054)
            {
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                var hint = mx.Message.Contains("display_name", StringComparison.OrdinalIgnoreCase)
                    ? " Run database/alter_users_display_name.sql (adds users.display_name)."
                    : mx.Message.Contains("gap_solution", StringComparison.OrdinalIgnoreCase) ||
                      mx.Message.Contains("pickup_", StringComparison.OrdinalIgnoreCase)
                        ? " Run database/alter_listings_fulfillment.sql."
                        : " Run scripts under database/ (see marketplace_schema.sql) so columns match the API.";
                var detail = app.Environment.IsDevelopment()
                    ? $"[{mx.ErrorCode}] {mx.Message}{hint}"
                    : "Database schema does not match the application.";
                await context.Response.WriteAsJsonAsync(new
                {
                    title = "Database schema error",
                    detail,
                });
                return;
            }

            if (mx.ErrorCode == MySqlErrorCode.DataTooLong || mx.Number == 1406)
            {
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                var detail = app.Environment.IsDevelopment()
                    ? $"[{mx.ErrorCode}] {mx.Message} Listing photos need a wide column: run database/alter_listings_image_url_mediumtext.sql (MEDIUMTEXT). The app also compresses images on upload."
                    : "Stored value too large for the database column.";
                await context.Response.WriteAsJsonAsync(new
                {
                    title = "Database column too small",
                    detail,
                });
                return;
            }

            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            var baseDetail =
                "Could not connect to MySQL. Check ConnectionStrings__DefaultConnection in .env, or DATABASE_URL / JAWSDB_URL "
                + "(mysql://… from Heroku). For AWS RDS, allow inbound TCP 3306 from your public IP in the RDS security group. ";
            var connDetail = app.Environment.IsDevelopment()
                ? baseDetail + $"[{mx.ErrorCode}] {mx.Message}"
                : baseDetail.TrimEnd();
            await context.Response.WriteAsJsonAsync(new
            {
                title = "Database unavailable",
                detail = connDetail,
            });
            return;
        }

        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(new
        {
            title = "Server error",
            detail = app.Environment.IsDevelopment() ? ex?.Message ?? "Unknown error." : "An unexpected error occurred.",
        });
    });
});

app.UseCors("Frontend");

// Serve `frontend/` (repo root) in dev and on Heroku so one dyno hosts SPA + API. Same-origin → empty API_BASE in app.js.
var frontendPath = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "..", "frontend"));
if (Directory.Exists(frontendPath))
{
    var files = new PhysicalFileProvider(frontendPath);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
}

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
