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
    /// MVP: image → listing suggestions (stub for now; will be backed by hosted vision model).
    /// Accepts multipart/form-data with field name "image".
    /// </summary>
    [AllowAnonymous]
    [HttpPost("listing-from-image")]
    [RequestSizeLimit(6_000_000)]
    [ProducesResponseType(typeof(AiListingSuggestionDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<AiListingSuggestionDto>> ListingFromImage([FromForm] IFormFile? image, CancellationToken cancellationToken)
    {
        if (image is null || image.Length <= 0)
        {
            return BadRequest("Missing image file.");
        }

        if (image.Length > 6_000_000)
        {
            return BadRequest("Image too large (max 6MB).");
        }

        byte[] bytes;
        await using (var s = image.OpenReadStream())
        await using (var ms = new MemoryStream())
        {
            await s.CopyToAsync(ms, cancellationToken);
            bytes = ms.ToArray();
        }

        try
        {
            var suggestion = await _ai.SuggestAsync(bytes, cancellationToken);
            return Ok(suggestion);
        }
        catch (AiSuggestException ex)
        {
            return StatusCode(ex.StatusCode, new { detail = ex.Message });
        }
    }
}

