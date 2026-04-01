using FullstackWithLlm.Api.Data;
using FullstackWithLlm.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FullstackWithLlm.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class ListingsController : ControllerBase
{
    private readonly ListingRepository _listings;

    public ListingsController(ListingRepository listings)
    {
        _listings = listings;
    }

    [AllowAnonymous]
    [HttpGet("feed")]
    [ProducesResponseType(typeof(IReadOnlyList<ListingFeedItemDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ListingFeedItemDto>>> GetFeed(
        [FromQuery] int limit = 24,
        [FromQuery] int? campusId = null,
        CancellationToken cancellationToken = default)
    {
        if (limit < 1)
        {
            limit = 24;
        }

        if (limit > 100)
        {
            limit = 100;
        }

        var rows = await _listings.GetFeedAsync(limit, campusId, cancellationToken);
        return Ok(rows);
    }

    [AllowAnonymous]
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(ListingDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ListingDetailDto>> GetById(int id, CancellationToken cancellationToken = default)
    {
        var row = await _listings.GetByIdAsync(id, cancellationToken);
        if (row is null)
        {
            return NotFound();
        }

        return Ok(row);
    }
}
