using System.Collections.Generic;
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
        var key = RequireApiKey();

        var prompt = """
You are helping a student marketplace app create a listing from a photo.

Return ONLY valid JSON (no markdown) with exactly these keys:
title, category, condition, listingType, price, gapSolution, description, dimensions,
cropLeft, cropTop, cropWidth, cropHeight

Rules:
- category must be one of: bedding, appliance, cookware, decor, electronics, furniture, storage, lighting, textbooks, other
- condition must be one of: new, like_new, good, fair
- listingType must be one of: sell, donate
- if listingType is donate, price must be 0
- gapSolution must be one of: storage, pickup_window, ship_or_deliver
- description should be 1-3 sentences, practical and honest.
- dimensions can be null if unknown.
- cropLeft, cropTop, cropWidth, cropHeight: axis-aligned bounding box of THIS listing's item only, as fractions of the full image width/height (0 to 1). cropLeft/cropTop are the top-left corner; cropWidth/cropHeight are size. The box must fully contain the listed item. If the whole photo is basically one item, use 0, 0, 1, 1.
""";

        var content = await ChatVisionAssistantContentAsync(key, imageBytes, prompt, cancellationToken);

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

    /// <summary>One photo that may contain several distinct items → multiple listing drafts.</summary>
    public async Task<List<AiListingSuggestionDto>> SuggestPileAsync(byte[] imageBytes, CancellationToken cancellationToken = default)
    {
        var key = RequireApiKey();

        var prompt = """
The photo may show MULTIPLE distinct physical items (a pile, desk spread, etc.). Identify each visually separate item someone could list individually (e.g. lamp, textbook, storage bin).

Return ONLY valid JSON (no markdown) with exactly this shape:
{ "listings": [ { ... }, ... ] }

Each array element must have exactly these keys:
title, category, condition, listingType, price, gapSolution, description, dimensions,
cropLeft, cropTop, cropWidth, cropHeight

Rules:
- Put ONE object per distinct item. Minimum 1 listing, maximum 12.
- If the photo is really a single item, return listings with length 1.
- category must be one of: bedding, appliance, cookware, decor, electronics, furniture, storage, lighting, textbooks, other
- condition must be one of: new, like_new, good, fair
- listingType must be one of: sell, donate
- if listingType is donate, price must be 0
- gapSolution must be one of: storage, pickup_window, ship_or_deliver
- description should be 1-3 sentences per item, practical and honest.
- dimensions can be null if unknown.
- Give each item its own title (not generic duplicates if items differ).

Bounding boxes (cropLeft, cropTop, cropWidth, cropHeight) — axis-aligned, normalized 0–1:
- These are DETECTION-style crops: each box should tightly frame ONE item, like object detection output.
- If there are 2+ listings, it is WRONG to use the same full-frame box (0, 0, 1, 1) for every item. Each listing must have a different, tighter box when items are spatially separable.
- Avoid cropWidth*cropHeight > 0.85 unless the item truly fills almost the entire photo. Prefer smaller boxes that still fully contain the item.
- Boxes for different items should overlap as little as possible.
- Estimate corners even for partially occluded items; do not leave crops missing or default to the whole image out of laziness.
""";

        var content = await ChatVisionAssistantContentAsync(key, imageBytes, prompt, cancellationToken);

        PileListingsRootDto? root;
        try
        {
            root = JsonSerializer.Deserialize<PileListingsRootDto>(content, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
        }
        catch (JsonException ex)
        {
            throw new AiSuggestException(502, $"Invalid pile JSON from model: {ex.Message}");
        }

        if (root?.Listings is null || root.Listings.Count == 0)
        {
            throw new AiSuggestException(502, "Model returned no listings for pile mode.");
        }

        const int max = 12;
        var list = new List<AiListingSuggestionDto>();
        foreach (var item in root.Listings)
        {
            if (list.Count >= max)
            {
                break;
            }

            list.Add(Normalize(item));
        }

        return list;
    }

    private string RequireApiKey()
    {
        var key = ResolveOpenAiApiKey();
        if (string.IsNullOrWhiteSpace(key))
        {
            throw new AiSuggestException(
                400,
                "No OpenAI API key. Set OPENAI_API_KEY in .env or your environment (OpenAI:ApiKey in appsettings also works), then restart the API.");
        }

        return key;
    }

    private async Task<string> ChatVisionAssistantContentAsync(
        string apiKey,
        byte[] imageBytes,
        string userTextPrompt,
        CancellationToken cancellationToken)
    {
        var model = _config["OPENAI_MODEL"] ?? "gpt-4o-mini";
        var dataUrl = $"data:image/jpeg;base64,{Convert.ToBase64String(imageBytes)}";

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
                        new { type = "text", text = userTextPrompt },
                        new { type = "image_url", image_url = new { url = dataUrl } },
                    },
                },
            },
            temperature = 0.2,
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey.Trim());
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

        return content;
    }

    private sealed class PileListingsRootDto
    {
        public List<AiListingSuggestionDto>? Listings { get; set; }
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

        s.Category = Pick(s.Category, "other", "bedding", "appliance", "cookware", "decor", "electronics", "furniture", "storage", "lighting", "textbooks");
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

        NormalizeCropBox(s);

        return s;
    }

    private static void NormalizeCropBox(AiListingSuggestionDto s)
    {
        void Clear()
        {
            s.CropLeft = s.CropTop = s.CropWidth = s.CropHeight = null;
        }

        if (s.CropLeft is null || s.CropTop is null || s.CropWidth is null || s.CropHeight is null)
        {
            Clear();
            return;
        }

        var left = decimal.Clamp(s.CropLeft.Value, 0m, 1m);
        var top = decimal.Clamp(s.CropTop.Value, 0m, 1m);
        var w = decimal.Clamp(s.CropWidth.Value, 0m, 1m);
        var h = decimal.Clamp(s.CropHeight.Value, 0m, 1m);
        if (w < 0.02m || h < 0.02m)
        {
            Clear();
            return;
        }

        if (left + w > 1m)
        {
            w = 1m - left;
        }

        if (top + h > 1m)
        {
            h = 1m - top;
        }

        s.CropLeft = left;
        s.CropTop = top;
        s.CropWidth = w;
        s.CropHeight = h;
    }
}

