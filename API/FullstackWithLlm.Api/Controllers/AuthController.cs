using System.Net.Mime;
using FullstackWithLlm.Api.Data;
using FullstackWithLlm.Api.Models;
using FullstackWithLlm.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FullstackWithLlm.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class AuthController : ControllerBase
{
    private static readonly HashSet<char> ValidSuiteLetters = new() { 'A', 'B', 'C', 'D' };

    private readonly UserRepository _users;
    private readonly JwtTokenService _jwt;

    public AuthController(UserRepository users, JwtTokenService jwt)
    {
        _users = users;
        _jwt = jwt;
    }

    [AllowAnonymous]
    [HttpPost("register")]
    [Consumes(MediaTypeNames.Application.Json)]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<AuthResponse>> Register([FromBody] RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || !request.Email.Contains('@', StringComparison.Ordinal))
        {
            return BadRequest("A valid email is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 8)
        {
            return BadRequest("Password must be at least 8 characters.");
        }

        if (string.IsNullOrWhiteSpace(request.Phone))
        {
            return BadRequest("Phone is required.");
        }

        if (!DateTime.TryParse(request.MoveDate, out var moveDate))
        {
            return BadRequest("Move date must be a valid date (use yyyy-MM-dd).");
        }

        if (string.IsNullOrWhiteSpace(request.MoveOutDate) ||
            !DateTime.TryParse(request.MoveOutDate, out var moveOutDate))
        {
            return BadRequest("Move-out date must be a valid date (use yyyy-MM-dd).");
        }

        string? dorm = null;
        char? suite = null;

        if (request.LivesOnCampus)
        {
            if (string.IsNullOrWhiteSpace(request.DormBuilding))
            {
                return BadRequest("Dorm building is required when living on campus.");
            }

            dorm = request.DormBuilding.Trim();
            var needsSuite = request.RequiresSuiteLetter ?? true;

            if (needsSuite)
            {
                var suiteRaw = request.SuiteLetter?.Trim().ToUpperInvariant();
                if (string.IsNullOrEmpty(suiteRaw) || suiteRaw.Length != 1 || !ValidSuiteLetters.Contains(suiteRaw[0]))
                {
                    return BadRequest("Suite letter must be A, B, C, or D for this building.");
                }

                suite = suiteRaw[0];
            }
            else
            {
                if (!string.IsNullOrWhiteSpace(request.SuiteLetter))
                {
                    return BadRequest("Suite letter is not used for this building type.");
                }

                suite = null;
            }
        }

        if (await _users.GetByEmailAsync(request.Email) is not null)
        {
            return Conflict("An account with this email already exists.");
        }

        var hash = BCrypt.Net.BCrypt.HashPassword(request.Password, workFactor: 12);

        var newId = await _users.TryCreateAsync(
            request.Email,
            hash,
            request.Phone,
            request.LivesOnCampus,
            moveDate,
            moveOutDate,
            dorm,
            suite);

        if (newId is null)
        {
            return Conflict("An account with this email already exists.");
        }

        var (token, expires) = _jwt.CreateToken(newId.Value, request.Email.Trim().ToLowerInvariant());
        return CreatedAtAction(nameof(Login), new { }, new AuthResponse
        {
            Token = token,
            Email = request.Email.Trim().ToLowerInvariant(),
            ExpiresAtUtc = expires,
        });
    }

    [AllowAnonymous]
    [HttpPost("login")]
    [Consumes(MediaTypeNames.Application.Json)]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<AuthResponse>> Login([FromBody] LoginRequest request)
    {
        var emailRaw = request.Email?.Trim() ?? "";
        var passwordRaw = request.Password ?? "";
        if (string.IsNullOrWhiteSpace(emailRaw) || string.IsNullOrWhiteSpace(passwordRaw))
        {
            return Unauthorized("Invalid email or password.");
        }

        var user = await _users.GetByEmailAsync(emailRaw);
        if (user is null)
        {
            return Unauthorized("Invalid email or password.");
        }

        if (string.IsNullOrWhiteSpace(user.PasswordHash))
        {
            return Unauthorized("Invalid email or password.");
        }

        bool passwordOk;
        try
        {
            // Non-BCrypt values in password_hash (e.g. manual SQL inserts) throw — treat as failed login.
            passwordOk = BCrypt.Net.BCrypt.Verify(passwordRaw, user.PasswordHash);
        }
        catch
        {
            passwordOk = false;
        }

        if (!passwordOk)
        {
            return Unauthorized("Invalid email or password.");
        }

        var emailForToken = user.Email.Trim().ToLowerInvariant();
        var (token, expires) = _jwt.CreateToken(user.Id, emailForToken);
        return Ok(new AuthResponse
        {
            Token = token,
            Email = emailForToken,
            ExpiresAtUtc = expires,
        });
    }
}
