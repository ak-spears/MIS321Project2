namespace FullstackWithLlm.Api.Models;

public sealed class OpenConversationRequestDto
{
    public int ListingId { get; set; }
    public string ListingKey { get; set; } = "";
    public string ListingTitle { get; set; } = "";
    public int SellerUserId { get; set; }
    public string SellerLabel { get; set; } = "";
    public int BuyerUserId { get; set; }
    public string BuyerLabel { get; set; } = "";
}

public sealed class SendMessageRequestDto
{
    public string Text { get; set; } = "";
}

public sealed class MessageEntryDto
{
    public long MessageId { get; set; }
    public int SenderUserId { get; set; }
    public string SenderLabel { get; set; } = "";
    public string Text { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

public sealed class MessageConversationDto
{
    public string Id { get; set; } = "";
    public string ListingKey { get; set; } = "";
    public string ListingTitle { get; set; } = "";
    public int SellerUserId { get; set; }
    public string SellerLabel { get; set; } = "";
    public int BuyerUserId { get; set; }
    public string BuyerLabel { get; set; } = "";
    public Dictionary<string, string> LastReadAtByUserId { get; set; } = new();
    public DateTime UpdatedAt { get; set; }
    public List<MessageEntryDto> Messages { get; set; } = [];
}
