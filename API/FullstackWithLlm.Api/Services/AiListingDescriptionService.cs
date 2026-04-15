using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using FullstackWithLlm.Api.Models;

namespace FullstackWithLlm.Api.Services;

public sealed class AiListingDescriptionService
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;

    public AiListingDescriptionService(HttpClient httpClient, IConfiguration configuration)
    {
        _httpClient = httpClient;
        _configuration = configuration;
    }

    public async Task<GenerateListingDescriptionResponse> GenerateAsync(
        GenerateListingDescriptionRequest request,
        CancellationToken cancellationToken = default)
    {
        var apiKey = _configuration["OPENAI_API_KEY"] ?? _configuration["OpenAI:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("Missing OPENAI_API_KEY.");
        }

        var model = _configuration["OpenAI:Model"] ?? "gpt-4o-mini";
        var condition = NormalizeCondition(request.Condition);
        var priceLabel = request.Price <= 0 ? "Free" : $"${request.Price:0.00}";

        var payload = new
        {
            model,
            temperature = 0.7,
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content = "You write concise, natural marketplace listing descriptions. Return plain text only. No markdown, no bullets, no emojis.",
                },
                new
                {
                    role = "user",
                    content =
                        $"Write a clean listing description in 2-4 sentences. " +
                        $"Item name: {request.ItemName}. Condition: {condition}. Price: {priceLabel}. " +
                        $"Mention key buyer-relevant details and keep tone trustworthy.",
                },
            },
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        using var res = await _httpClient.SendAsync(req, cancellationToken);
        var content = await res.Content.ReadAsStringAsync(cancellationToken);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"OpenAI request failed ({(int)res.StatusCode}).");
        }

        using var doc = JsonDocument.Parse(content);
        var description = doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString();

        return new GenerateListingDescriptionResponse
        {
            Description = string.IsNullOrWhiteSpace(description)
                ? "Well-maintained item in solid condition. Great option for a student setup and priced to move quickly."
                : description.Trim(),
        };
    }

    private static string NormalizeCondition(string condition)
    {
        return condition.Trim().ToLowerInvariant() switch
        {
            "new" => "new / unused",
            "like_new" => "like new",
            "good" => "good",
            "fair" => "fair",
            _ => condition.Trim(),
        };
    }
}
