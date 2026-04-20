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
    public DateTime CreatedAt { get; init; }

    /// <summary>Set on <c>GET /api/transactions/sales</c> for seller inbox (Messages / coordination).</summary>
    public int? BuyerId { get; init; }

    /// <summary>Buyer display name when the viewer is the seller.</summary>
    public string? BuyerDisplayName { get; init; }

    /// <summary>Set on <c>GET /api/transactions/mine</c> so the buyer can message the seller from the row.</summary>
    public int? SellerId { get; init; }

    /// <summary>Seller display name on buyer&apos;s transaction rows.</summary>
    public string? SellerDisplayName { get; init; }
}
