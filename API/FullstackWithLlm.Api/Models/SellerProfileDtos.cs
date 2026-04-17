namespace FullstackWithLlm.Api.Models;

public sealed class SellerUserDto
{
    public int UserId { get; init; }
    public int CampusId { get; init; }
    public string DisplayName { get; init; } = "";
    public string Phone { get; init; } = "";
    public bool LivesOnCampus { get; init; }
    public DateTime? MoveInDate { get; init; }
    public DateTime? MoveOutDate { get; init; }
    public string? DormBuilding { get; init; }
    public string? SuiteLetter { get; init; }
    public string? AvatarUrl { get; init; }
    public string? DefaultGapSolution { get; init; }
    public string? PreferredReceiveGap { get; init; }
    public DateTime? CreatedAt { get; init; }

    /// <summary>When true, marketplace blocks this user from posting or editing listings.</summary>
    public bool OnProbation { get; set; }
}

public sealed class RatingSummaryDto
{
    public decimal AverageScore { get; init; }
    public int RatingCount { get; init; }
}

public sealed class UserRatingDto
{
    public int RatingId { get; init; }
    public int ListingId { get; init; }
    public int RaterId { get; init; }
    public string RaterDisplayName { get; init; } = "";
    public int RateeId { get; init; }
    public byte Score { get; init; }
    public string? Comment { get; init; }
    public bool IsFlagged { get; init; }
    public bool IsHarsh { get; init; }
    public DateTime? CreatedAt { get; init; }
}

public sealed class SellerProfileDto
{
    public SellerUserDto User { get; init; } = new();
    public RatingSummaryDto Rating { get; init; } = new();
    public IReadOnlyList<UserRatingDto> Reviews { get; init; } = Array.Empty<UserRatingDto>();
    public IReadOnlyList<ListingFeedItemDto> Listings { get; init; } = Array.Empty<ListingFeedItemDto>();

    /// <summary>
    /// Mid-rank percentile (0–100) of this seller&apos;s average received rating vs other sellers who meet
    /// minRatingsForPercentile. Higher is better (e.g. ~99 ≈ top 1%). Null if the seller is not in the cohort.
    /// </summary>
    public decimal? RatingAveragePercentile { get; init; }

    /// <summary>How many sellers were included in the percentile cohort (including this seller when applicable).</summary>
    public int RatingPercentilePeerSellerCount { get; init; }
}

