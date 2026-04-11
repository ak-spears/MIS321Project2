namespace FullstackWithLlm.Api.Models;

public sealed class UserProfileDto
{
    public int UserId { get; init; }
    public int CampusId { get; init; }
    public string Email { get; init; } = "";
    public string DisplayName { get; init; } = "";
    public string Phone { get; init; } = "";
    public bool LivesOnCampus { get; init; }
    public DateTime MoveInDate { get; init; }
    public DateTime? MoveOutDate { get; init; }
    public string? DormBuilding { get; init; }
    public string? SuiteLetter { get; init; }
    public string? AvatarUrl { get; init; }
    /// <summary>storage | pickup_window | ship_or_deliver — default when creating listings.</summary>
    public string? DefaultGapSolution { get; init; }
    /// <summary>storage | pickup_window | ship_or_deliver — preferred way to receive items when buying.</summary>
    public string? PreferredReceiveGap { get; init; }
}

public sealed class UpdateUserProfileRequest
{
    public string DisplayName { get; set; } = "";
    public string Phone { get; set; } = "";
    public bool LivesOnCampus { get; set; }
    /// <summary>ISO date string (yyyy-MM-dd).</summary>
    public string MoveInDate { get; set; } = "";
    /// <summary>ISO date string (yyyy-MM-dd) or empty to clear.</summary>
    public string? MoveOutDate { get; set; }
    public string? DormBuilding { get; set; }
    /// <summary>Single letter A, B, C, or D (optional).</summary>
    public string? SuiteLetter { get; set; }
    public string? AvatarUrl { get; set; }
    /// <summary>storage | pickup_window | ship_or_deliver, or null to clear.</summary>
    public string? DefaultGapSolution { get; set; }
    /// <summary>storage | pickup_window | ship_or_deliver, or null to clear — when buying.</summary>
    public string? PreferredReceiveGap { get; set; }
}

