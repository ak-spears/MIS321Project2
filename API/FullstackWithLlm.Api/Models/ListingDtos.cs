namespace FullstackWithLlm.Api.Models;

public sealed class ListingFeedItemDto
{
    public int ListingId { get; init; }
    public string Title { get; init; } = "";
    public string? Description { get; init; }
    public decimal Price { get; init; }
    public string? Category { get; init; }
    public string? ImageUrl { get; init; }
    public string Status { get; init; } = "";
    public string SellerDisplayName { get; init; } = "";
    public DateTime CreatedAt { get; init; }
}

public sealed class ListingDetailDto
{
    public int ListingId { get; init; }
    public string Title { get; init; } = "";
    public string? Description { get; init; }
    public decimal Price { get; init; }
    public string? Category { get; init; }
    public string? ImageUrl { get; init; }
    public string Status { get; init; } = "";
    public string SellerDisplayName { get; init; } = "";
    public DateTime CreatedAt { get; init; }
}
