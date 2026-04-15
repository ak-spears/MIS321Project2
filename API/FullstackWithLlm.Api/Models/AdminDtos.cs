namespace FullstackWithLlm.Api.Models;

public sealed class AdminDashboardDto
{
    public IReadOnlyList<WeeklyCountDto> NewListingsByWeek { get; init; } = Array.Empty<WeeklyCountDto>();
    public IReadOnlyList<WeeklyRevenueDto> RevenueByWeek { get; init; } = Array.Empty<WeeklyRevenueDto>();
    public DonationHandoffSummaryDto DonationHandoffs { get; init; } = new();
    public IReadOnlyList<LowRatedUserDto> LowRatedUsers { get; init; } = Array.Empty<LowRatedUserDto>();
    public IReadOnlyList<FlaggedReviewDto> FlaggedOrHarshReviews { get; init; } = Array.Empty<FlaggedReviewDto>();
}

public sealed class WeeklyCountDto
{
    public string WeekStart { get; init; } = ""; // yyyy-MM-dd (Monday)
    public int Count { get; init; }
}

public sealed class WeeklyRevenueDto
{
    public string WeekStart { get; init; } = ""; // yyyy-MM-dd (Monday)
    public decimal GrossAmount { get; init; }
    public decimal PlatformFees { get; init; }
    public int CompletedTransactions { get; init; }
}

public sealed class DonationHandoffSummaryDto
{
    public int PickedUpCount { get; init; }
    public int NotPickedUpCount { get; init; }
}

public sealed class LowRatedUserDto
{
    public int UserId { get; init; }
    public string DisplayName { get; init; } = "";
    public decimal AvgRating { get; init; }
    public int RatingCount { get; init; }
}

public sealed class FlaggedReviewDto
{
    public int RatingId { get; init; }
    public int ListingId { get; init; }
    public int RaterId { get; init; }
    public int RateeId { get; init; }
    public byte Score { get; init; }
    public string? Comment { get; init; }
    public bool IsFlagged { get; init; }
    public bool IsHarsh { get; init; }
    public string CreatedAt { get; init; } = ""; // ISO-ish
}

