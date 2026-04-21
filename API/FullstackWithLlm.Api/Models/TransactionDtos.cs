using System.Text.Json.Serialization;

namespace FullstackWithLlm.Api.Models;

public sealed class CreateTransactionRequest
{
    /// <summary>Published listing to buy or claim (free).</summary>
    [JsonPropertyName("listingId")]
    public int ListingId { get; set; }

    /// <summary>cash | card — in-app settlement is peer-to-peer; this is for record-keeping.</summary>
    [JsonPropertyName("paymentMethod")]
    public string PaymentMethod { get; set; } = "cash";
}

/// <summary>Buyer&apos;s transaction row for the Transactions UI.</summary>
public sealed class TransactionListItemDto
{
    public int TransactionId { get; init; }
    public int ListingId { get; init; }
    public string Title { get; init; } = "";
    public decimal Amount { get; init; }
    public decimal PlatformFee { get; init; }
    public string PaymentMethod { get; init; } = "cash";
    /// <summary>pending | completed | cancelled</summary>
    public string Status { get; init; } = "pending";
    /// <summary>True if buyer already left a rating for this transaction's listing/seller.</summary>
    public bool HasRating { get; init; }
    public DateTime CreatedAt { get; init; }
}

/// <summary>Seller-side view of an in-progress (claimed) sale.</summary>
public sealed class SellerSaleListItemDto
{
    public int TransactionId { get; init; }
    public int ListingId { get; init; }
    public string Title { get; init; } = "";
    public int BuyerId { get; init; }
    public string BuyerDisplayName { get; init; } = "";
    /// <summary>pending | completed | cancelled</summary>
    public string Status { get; init; } = "pending";
    public DateTime CreatedAt { get; init; }
}

public sealed class CreateTransactionRatingRequestDto
{
    /// <summary>1–5 stars.</summary>
    [JsonPropertyName("score")]
    public byte Score { get; set; }

    /// <summary>Optional review text (max 500 chars).</summary>
    [JsonPropertyName("comment")]
    public string? Comment { get; set; }
}
