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
    /// <summary>Delivery/transfer (<c>gap_solution</c>): storage | pickup_window | ship_or_deliver; null if column missing in older DBs.</summary>
    public string? GapSolution { get; init; }
    public string? ImageUrl { get; init; }
    public string Status { get; init; } = "";
    public string SellerDisplayName { get; init; } = "";
    public DateTime CreatedAt { get; init; }
}

public sealed class CreateListingRequest
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public decimal Price { get; set; }
    public string? Category { get; set; }
    /// <summary>Delivery/transfer method stored in <c>listings.gap_solution</c>: storage | pickup_window | ship_or_deliver.</summary>
    public string? GapSolution { get; set; }
    public string? StorageNotes { get; set; }
    /// <summary>ISO date yyyy-MM-dd or empty.</summary>
    public string? PickupStart { get; set; }
    public string? PickupEnd { get; set; }
    public string? PickupLocation { get; set; }
    public string? DeliveryNotes { get; set; }
    /// <summary>HTTPS URL or data:image… base64.</summary>
    public string? ImageUrl { get; set; }
}

public sealed class ListingDetailDto
{
    public int ListingId { get; init; }
    public int SellerId { get; init; }
    public string Title { get; init; } = "";
    public string? Description { get; init; }
    public decimal Price { get; init; }
    public string? Category { get; init; }
    /// <summary>Delivery/transfer method (<c>listings.gap_solution</c>).</summary>
    public string? GapSolution { get; init; }
    public string? StorageNotes { get; init; }
    public DateTime? PickupStart { get; init; }
    public DateTime? PickupEnd { get; init; }
    public string? PickupLocation { get; init; }
    public string? DeliveryNotes { get; init; }
    public string? ImageUrl { get; init; }
    public string Status { get; init; } = "";
    public string SellerDisplayName { get; init; } = "";
    public DateTime CreatedAt { get; init; }
}
