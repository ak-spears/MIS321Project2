namespace FullstackWithLlm.Api.Models;

public sealed class ListingFeedItemDto
{
    public int ListingId { get; init; }
    /// <summary>Listing owner — used by the client to hide own items from the buy feed.</summary>
    public int SellerId { get; init; }
    /// <summary>Campus this listing belongs to (home feed filters).</summary>
    public int CampusId { get; init; }
    public string Title { get; init; } = "";
    public string? Description { get; init; }
    public decimal Price { get; init; }
    public string? Category { get; init; }
    /// <summary>new | like_new | good | fair (<c>item_condition</c>); null if unknown or column missing.</summary>
    public string? Condition { get; init; }
    /// <summary>Delivery/transfer (<c>gap_solution</c>): storage | pickup_window | ship_or_deliver; null if column missing in older DBs.</summary>
    public string? GapSolution { get; init; }
    /// <summary><c>small_dorm</c> | <c>any_space</c> — null if column missing or unset.</summary>
    public string? SpaceSuitability { get; init; }
    /// <summary>When true, seller is open to offers below the listed price.</summary>
    public bool OrBestOffer { get; init; }
    public string? ImageUrl { get; init; }
    public string Status { get; init; } = "";
    public string SellerDisplayName { get; init; } = "";
    public DateTime CreatedAt { get; init; }
    public int? MatchScore { get; set; }
    public string? MatchReason { get; set; }
}

public sealed class CreateListingRequest
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public decimal Price { get; set; }
    public string? Category { get; set; }
    /// <summary>new | like_new | good | fair — stored as <c>item_condition</c>.</summary>
    public string? Condition { get; set; }
    public string? Dimensions { get; set; }
    /// <summary>Delivery/transfer method stored in <c>listings.gap_solution</c>: storage | pickup_window | ship_or_deliver.</summary>
    public string? GapSolution { get; set; }
    /// <summary><c>small_dorm</c> | <c>any_space</c> — stored in <c>listings.space_suitability</c>.</summary>
    public string? SpaceSuitability { get; set; }
    public string? StorageNotes { get; set; }
    /// <summary>ISO date yyyy-MM-dd or empty.</summary>
    public string? PickupStart { get; set; }
    public string? PickupEnd { get; set; }
    public string? PickupLocation { get; set; }
    public string? DeliveryNotes { get; set; }
    /// <summary>HTTPS URL or data:image… base64.</summary>
    public string? ImageUrl { get; set; }
    /// <summary>Buyer may offer below list price (ignored when <c>Price</c> is 0).</summary>
    public bool OrBestOffer { get; set; }
}

public sealed class ListingDetailDto
{
    public int ListingId { get; init; }
    public int SellerId { get; init; }
    public string Title { get; init; } = "";
    public string? Description { get; init; }
    public decimal Price { get; init; }
    public string? Category { get; init; }
    public string? Condition { get; init; }
    public string? Dimensions { get; init; }
    /// <summary>Delivery/transfer method (<c>listings.gap_solution</c>).</summary>
    public string? GapSolution { get; init; }
    /// <summary><c>small_dorm</c> | <c>any_space</c>.</summary>
    public string? SpaceSuitability { get; init; }
    public bool OrBestOffer { get; init; }
    public string? StorageNotes { get; init; }
    public DateTime? PickupStart { get; init; }
    public DateTime? PickupEnd { get; init; }
    public string? PickupLocation { get; init; }
    public string? DeliveryNotes { get; init; }
    public string? ImageUrl { get; init; }
    public string Status { get; init; } = "";
    public string SellerDisplayName { get; init; } = "";
    /// <summary>Null when the DB has an invalid/zero datetime (MySQL legacy rows).</summary>
    public DateTime? CreatedAt { get; init; }
}

/// <summary>Listing detail plus reviews for this listing and the seller&apos;s overall rating (SPA detail page).</summary>
public sealed class ListingDetailContextDto
{
    public ListingDetailDto Listing { get; init; } = new();
    public IReadOnlyList<UserRatingDto> ListingReviews { get; init; } = Array.Empty<UserRatingDto>();
    public RatingSummaryDto SellerRatingSummary { get; init; } = new();
}

public sealed class ListingMatchReasonDto
{
    public int ListingId { get; init; }
    public int Score { get; init; }
    public string Reason { get; init; } = "";
}
