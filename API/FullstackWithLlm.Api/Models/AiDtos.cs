namespace FullstackWithLlm.Api.Models;

public sealed class AiListingSuggestionDto
{
    public string Title { get; set; } = "";
    /// <summary>bedding | appliance | furniture | storage | lighting | textbooks | other</summary>
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
}

