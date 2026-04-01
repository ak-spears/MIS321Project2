using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace FullstackWithLlm.Api.Services;

public sealed class JwtTokenService
{
    private readonly string _issuer;
    private readonly string _audience;
    private readonly SymmetricSecurityKey _signingKey;
    private readonly TimeSpan _lifetime = TimeSpan.FromDays(7);

    public JwtTokenService(IConfiguration configuration)
    {
        var signingKey = configuration["Jwt:SigningKey"];
        if (string.IsNullOrWhiteSpace(signingKey) || signingKey.Length < 32)
        {
            throw new InvalidOperationException(
                "Jwt:SigningKey must be set (env Jwt__SigningKey) and at least 32 characters.");
        }

        _issuer = configuration["Jwt:Issuer"] ?? "FullstackWithLlm.Api";
        _audience = configuration["Jwt:Audience"] ?? "CampusDormMarketplace";
        _signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey));
    }

    public (string Token, DateTime ExpiresAtUtc) CreateToken(int userId, string email)
    {
        var expires = DateTime.UtcNow.Add(_lifetime);
        var creds = new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Email, email),
            new(ClaimTypes.NameIdentifier, userId.ToString()),
        };

        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims: claims,
            expires: expires,
            signingCredentials: creds);

        var jwt = new JwtSecurityTokenHandler().WriteToken(token);
        return (jwt, expires);
    }
}
