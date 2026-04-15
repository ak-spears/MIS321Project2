namespace FullstackWithLlm.Api.Models;

public sealed class AiListingSuggestionDto
{
    public string Title { get; set; } = "";
    /// <summary>bedding | appliance | cookware | decor | electronics | furniture | storage | lighting | textbooks | other</summary>
    public string Category { get; set; } = "other";
    /// <summary>new | like_new | good | fair</summary>
    public string Condition { get; set; } = "good";
    /// <summary>sell | donate</summary>
    public string ListingType { get; set; } = "sell";
    public decimal Price { get; set; } = 0;
    /// <summary>storage | pickup_window | ship_or_deliver</summary>
    public string GapSolution { get; set; } = "storage";
    public string Description { get; set; } = "";
    public string? Dimensions { get; set; }

    /// <summary>Optional crop of this listing's item in the image, normalized 0–1 (left, top, width, height).</summary>
    public decimal? CropLeft { get; set; }
    public decimal? CropTop { get; set; }
    public decimal? CropWidth { get; set; }
    public decimal? CropHeight { get; set; }
}

/// <summary>Response when splitting one photo into multiple listing suggestions (pile mode).</summary>
public sealed class AiPileListingsResponseDto
{
    public List<AiListingSuggestionDto> Listings { get; set; } = new();
}

public sealed class GenerateListingDescriptionRequest
{
    public string ItemName { get; set; } = "";
    public string Condition { get; set; } = "";
    public decimal Price { get; set; }
}

public sealed class GenerateListingDescriptionResponse
{
    public string Description { get; set; } = "";
}

