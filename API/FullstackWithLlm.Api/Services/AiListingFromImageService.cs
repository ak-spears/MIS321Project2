using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using FullstackWithLlm.Api.Models;
using Microsoft.Extensions.Configuration;

namespace FullstackWithLlm.Api.Services;

public sealed class AiSuggestException : Exception
{
    public int StatusCode { get; }

    public AiSuggestException(int statusCode, string message) : base(message)
    {
        StatusCode = statusCode;
    }
}

public sealed class AiListingFromImageService
{
    private readonly IConfiguration _config;
    private readonly HttpClient _http;

    public AiListingFromImageService(IConfiguration config)
    {
        _config = config;
        _http = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(45),
        };
    }

    public async Task<AiListingSuggestionDto> SuggestAsync(byte[] imageBytes, CancellationToken cancellationToken = default)
    {
        var key = ResolveOpenAiApiKey();
        if (string.IsNullOrWhiteSpace(key))
        {
            throw new AiSuggestException(
                400,
                "No OpenAI API key. Set OPENAI_API_KEY in .env or your environment (OpenAI:ApiKey in appsettings also works), then restart the API.");
        }

        var model = _config["OPENAI_MODEL"] ?? "gpt-4o-mini";
        var dataUrl = $"data:image/jpeg;base64,{Convert.ToBase64String(imageBytes)}";

        var prompt = """
You are helping a student marketplace app create a listing from a photo.

Return ONLY valid JSON (no markdown) with exactly these keys:
title, category, condition, listingType, price, gapSolution, description, dimensions

Rules:
- category must be one of: bedding, appliance, furniture, storage, lighting, textbooks, other
- condition must be one of: new, like_new, good, fair
- listingType must be one of: sell, donate
- if listingType is donate, price must be 0
- gapSolution must be one of: storage, pickup_window, ship_or_deliver
- description should be 1-3 sentences, practical and honest.
- dimensions can be null if unknown.
""";

        var payload = new
        {
            model,
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new
                {
                    role = "user",
                    content = new object[]
                    {
                        new { type = "text", text = prompt },
                        new { type = "image_url", image_url = new { url = dataUrl } },
                    },
                },
            },
            temperature = 0.2,
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key.Trim());
        req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        using var res = await _http.SendAsync(req, cancellationToken);
        var raw = await res.Content.ReadAsStringAsync(cancellationToken);
        if (!res.IsSuccessStatusCode)
        {
            var detail = TryOpenAiErrorMessage(raw) ?? Truncate(raw, 500);
            throw new AiSuggestException(
                502,
                $"OpenAI request failed ({(int)res.StatusCode}): {detail}");
        }

        if (!TryParseAssistantJson(raw, out var content, out var parseErr))
        {
            throw new AiSuggestException(502, parseErr);
        }

        if (string.IsNullOrWhiteSpace(content))
        {
            throw new AiSuggestException(502, "OpenAI returned empty message content.");
        }

        AiListingSuggestionDto suggestion;
        try
        {
            suggestion = JsonSerializer.Deserialize<AiListingSuggestionDto>(content, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            }) ?? throw new AiSuggestException(502, "Model JSON deserialized to null.");
        }
        catch (JsonException ex)
        {
            throw new AiSuggestException(502, $"Invalid listing JSON from model: {ex.Message}");
        }

        return Normalize(suggestion);
    }

    private string? ResolveOpenAiApiKey()
    {
        var k = _config["OPENAI_API_KEY"];
        if (string.IsNullOrWhiteSpace(k))
        {
            k = _config["OpenAI:ApiKey"];
        }

        if (string.IsNullOrWhiteSpace(k))
        {
            k = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        }

        return string.IsNullOrWhiteSpace(k) ? null : k.Trim();
    }

    private static bool TryParseAssistantJson(string raw, out string? content, out string error)
    {
        content = null;
        error = "";
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var el = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content");
            content = el.GetString();
            return true;
        }
        catch (Exception ex)
        {
            error = $"Could not read OpenAI response: {ex.Message}";
            return false;
        }
    }

    private static string? TryOpenAiErrorMessage(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.TryGetProperty("error", out var err))
            {
                if (err.TryGetProperty("message", out var msg))
                {
                    return msg.GetString();
                }

                return err.ToString();
            }
        }
        catch
        {
            // ignore
        }

        return null;
    }

    private static string Truncate(string s, int max)
    {
        if (string.IsNullOrEmpty(s) || s.Length <= max) return s;
        return s[..max] + "…";
    }

    private static AiListingSuggestionDto Normalize(AiListingSuggestionDto s)
    {
        static string Pick(string raw, params string[] allowed)
        {
            var v = (raw ?? "").Trim();
            if (v == "") return allowed[0];
            foreach (var a in allowed)
            {
                if (string.Equals(v, a, StringComparison.OrdinalIgnoreCase)) return a;
            }
            return allowed[0];
        }

        s.Title = (s.Title ?? "").Trim();
        if (s.Title == "") s.Title = "Dorm item";
        if (s.Title.Length > 150) s.Title = s.Title[..150];

        s.Category = Pick(s.Category, "other", "bedding", "appliance", "furniture", "storage", "lighting", "textbooks");
        s.Condition = Pick(s.Condition, "good", "new", "like_new", "fair");
        s.ListingType = Pick(s.ListingType, "sell", "donate");
        s.GapSolution = Pick(s.GapSolution, "storage", "pickup_window", "ship_or_deliver");

        s.Description = (s.Description ?? "").Trim();
        if (s.Description.Length > 1200) s.Description = s.Description[..1200];

        s.Dimensions = string.IsNullOrWhiteSpace(s.Dimensions) ? null : s.Dimensions.Trim();
        if (s.Dimensions != null && s.Dimensions.Length > 120) s.Dimensions = s.Dimensions[..120];

        if (s.ListingType == "donate")
        {
            s.Price = 0;
        }
        else
        {
            if (s.Price < 0) s.Price = 0;
            if (s.Price > 5000) s.Price = 5000;
        }

        return s;
    }
}

