namespace FullstackWithLlm.Api.Models;

public sealed class RegisterRequest
{
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
    public string Phone { get; set; } = "";
    public bool LivesOnCampus { get; set; }
    /// <summary>ISO date string (yyyy-MM-dd).</summary>
    public string MoveDate { get; set; } = "";
    /// <summary>ISO date string (yyyy-MM-dd).</summary>
    public string MoveOutDate { get; set; } = "";
    public string? DormBuilding { get; set; }
    /// <summary>Single letter A, B, C, or D for suite-style halls only.</summary>
    public string? SuiteLetter { get; set; }
    /// <summary>
    /// When on campus: true = suite letter required; false = must not send a suite letter.
    /// When null, defaults to true (legacy clients).
    /// </summary>
    public bool? RequiresSuiteLetter { get; set; }
}

public sealed class LoginRequest
{
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
}

public sealed class AuthResponse
{
    public string Token { get; set; } = "";
    public string Email { get; set; } = "";
    public DateTime ExpiresAtUtc { get; set; }
}
