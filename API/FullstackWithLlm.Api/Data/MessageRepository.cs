using FullstackWithLlm.Api.Models;
using System.Collections.Concurrent;

namespace FullstackWithLlm.Api.Data;

public sealed class MessageRepository
{
    private static readonly object Sync = new();
    private static readonly ConcurrentDictionary<string, MessageConversationDto> Conversations = new();
    private static long _messageIdSeed = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public MessageRepository(IConfiguration configuration) { }

    public async Task<IReadOnlyList<MessageConversationDto>> GetForUserAsync(int userId, CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;
        var rows = Conversations.Values
            .Where(c => c.SellerUserId == userId || c.BuyerUserId == userId)
            .OrderByDescending(c => c.UpdatedAt)
            .Select(CloneConversation)
            .ToList();
        return rows;
    }

    public async Task<MessageConversationDto?> OpenAsync(
        int actorUserId,
        OpenConversationRequestDto request,
        CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;
        if (request.ListingId <= 0)
        {
            return null;
        }

        var sellerId = request.SellerUserId;
        var buyerId = request.BuyerUserId > 0 ? request.BuyerUserId : actorUserId;
        if (buyerId <= 0 || sellerId <= 0 || buyerId == sellerId)
        {
            return null;
        }

        if (actorUserId != buyerId && actorUserId != sellerId)
        {
            return null;
        }

        var listingKey = string.IsNullOrWhiteSpace(request.ListingKey) ? $"db:{request.ListingId}" : request.ListingKey.Trim();
        var existing = Conversations.Values.FirstOrDefault(c =>
            c.ListingKey == listingKey &&
            c.SellerUserId == sellerId &&
            c.BuyerUserId == buyerId);
        if (existing != null)
        {
            return CloneConversation(existing);
        }

        var conversationId = Guid.NewGuid().ToString("N");
        var now = DateTime.UtcNow;
        var conversation = new MessageConversationDto
        {
            Id = conversationId,
            ListingKey = listingKey,
            ListingTitle = string.IsNullOrWhiteSpace(request.ListingTitle) ? "Listing" : request.ListingTitle.Trim(),
            SellerUserId = sellerId,
            SellerLabel = string.IsNullOrWhiteSpace(request.SellerLabel) ? $"User #{sellerId}" : request.SellerLabel.Trim(),
            BuyerUserId = buyerId,
            BuyerLabel = string.IsNullOrWhiteSpace(request.BuyerLabel) ? $"User #{buyerId}" : request.BuyerLabel.Trim(),
            LastReadAtByUserId = new Dictionary<string, string>(),
            UpdatedAt = now,
            Messages = [],
        };
        Conversations[conversationId] = conversation;
        return CloneConversation(conversation);
    }

    public async Task<MessageConversationDto?> GetByIdForUserAsync(
        int actorUserId,
        string conversationId,
        CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;
        if (!Conversations.TryGetValue(conversationId, out var conv))
        {
            return null;
        }

        if (actorUserId != conv.SellerUserId && actorUserId != conv.BuyerUserId)
        {
            return null;
        }

        return CloneConversation(conv);
    }

    public async Task<bool> AddMessageAsync(
        int actorUserId,
        string conversationId,
        string text,
        CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        text = text.Trim();
        if (text.Length > 600)
        {
            text = text[..600];
        }

        if (!Conversations.TryGetValue(conversationId, out var conv))
        {
            return false;
        }

        if (actorUserId != conv.SellerUserId && actorUserId != conv.BuyerUserId)
        {
            return false;
        }

        lock (Sync)
        {
            conv.Messages.Add(new MessageEntryDto
            {
                MessageId = Interlocked.Increment(ref _messageIdSeed),
                SenderUserId = actorUserId,
                SenderLabel = actorUserId == conv.SellerUserId ? conv.SellerLabel : conv.BuyerLabel,
                Text = text,
                CreatedAt = DateTime.UtcNow,
            });
            conv.UpdatedAt = DateTime.UtcNow;
        }

        return true;
    }

    public async Task<bool> MarkReadAsync(int actorUserId, string conversationId, CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;
        if (!Conversations.TryGetValue(conversationId, out var conv))
        {
            return false;
        }

        if (actorUserId != conv.SellerUserId && actorUserId != conv.BuyerUserId)
        {
            return false;
        }

        conv.LastReadAtByUserId[actorUserId.ToString()] = DateTime.UtcNow.ToString("O");
        return true;
    }

    private static MessageConversationDto CloneConversation(MessageConversationDto src)
    {
        return new MessageConversationDto
        {
            Id = src.Id,
            ListingKey = src.ListingKey,
            ListingTitle = src.ListingTitle,
            SellerUserId = src.SellerUserId,
            SellerLabel = src.SellerLabel,
            BuyerUserId = src.BuyerUserId,
            BuyerLabel = src.BuyerLabel,
            LastReadAtByUserId = new Dictionary<string, string>(src.LastReadAtByUserId),
            UpdatedAt = src.UpdatedAt,
            Messages = src.Messages
                .Select(m => new MessageEntryDto
                {
                    MessageId = m.MessageId,
                    SenderUserId = m.SenderUserId,
                    SenderLabel = m.SenderLabel,
                    Text = m.Text,
                    CreatedAt = m.CreatedAt,
                })
                .ToList(),
        };
    }
}
