namespace FullstackWithLlm.Api.Models;

public sealed class CreateTransactionRequest
{
    /// <summary>Published listing to buy or claim (free).</summary>
    public int ListingId { get; set; }

    /// <summary>cash | card — in-app settlement is peer-to-peer; this is for record-keeping.</summary>
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
}
