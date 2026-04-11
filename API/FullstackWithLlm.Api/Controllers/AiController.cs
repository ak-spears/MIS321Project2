using FullstackWithLlm.Api.Models;
using FullstackWithLlm.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FullstackWithLlm.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class AiController : ControllerBase
{
    private readonly AiListingFromImageService _ai;

    public AiController(AiListingFromImageService ai)
    {
        _ai = ai;
    }

    /// <summary>
    /// Image → listing suggestion(s). Form field <c>image</c> required; <c>pile</c> true = multiple items in one photo.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("listing-from-image")]
    [RequestSizeLimit(6_000_000)]
    [ProducesResponseType(typeof(AiListingSuggestionDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(AiPileListingsResponseDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult> ListingFromImage(
        [FromForm] IFormFile? image,
        [FromForm] string? pile,
        CancellationToken cancellationToken)
    {
        if (image is null || image.Length <= 0)
        {
            return BadRequest("Missing image file.");
        }

        if (image.Length > 6_000_000)
        {
            return BadRequest("Image too large (max 6MB).");
        }

        var pileMode = IsTruthyFormValue(pile);

        byte[] bytes;
        await using (var s = image.OpenReadStream())
        await using (var ms = new MemoryStream())
        {
            await s.CopyToAsync(ms, cancellationToken);
            bytes = ms.ToArray();
        }

        try
        {
            if (pileMode)
            {
                var listings = await _ai.SuggestPileAsync(bytes, cancellationToken);
                return Ok(new AiPileListingsResponseDto { Listings = listings });
            }

            var suggestion = await _ai.SuggestAsync(bytes, cancellationToken);
            return Ok(suggestion);
        }
        catch (AiSuggestException ex)
        {
            return StatusCode(ex.StatusCode, new { detail = ex.Message });
        }
    }

    private static bool IsTruthyFormValue(string? v) =>
        string.Equals(v, "true", StringComparison.OrdinalIgnoreCase)
        || string.Equals(v, "on", StringComparison.OrdinalIgnoreCase)
        || v == "1";
}

