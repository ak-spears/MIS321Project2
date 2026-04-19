using System.Linq;
using System.Security.Claims;
using FullstackWithLlm.Api.Data;
using FullstackWithLlm.Api.Models;
using FullstackWithLlm.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FullstackWithLlm.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class ListingsController : ControllerBase
{
    private readonly ListingRepository _listings;
    private readonly ListingMatchService _listingMatchService;
    private readonly RatingRepository _ratings;
    private readonly UserRepository _users;

    public ListingsController(
        ListingRepository listings,
        ListingMatchService listingMatchService,
        RatingRepository ratings,
        UserRepository users)
    {
        _listings = listings;
        _listingMatchService = listingMatchService;
        _ratings = ratings;
        _users = users;
    }

    /// <summary>
    /// Home feed: active for-sale listings (price &gt; 0) from other users — not free/donation rows. When authenticated, the current user&apos;s own listings are excluded (they appear under GET mine).
    /// </summary>
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

        if (limit > 250)
        {
            limit = 250;
        }

        int? excludeSellerId = null;
        if (User.Identity?.IsAuthenticated == true)
        {
            var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (int.TryParse(idRaw, out var uid) && uid > 0)
            {
                excludeSellerId = uid;
            }
        }

        var rows = await _listings.GetFeedAsync(limit, campusId, excludeSellerId, cancellationToken);
        if (excludeSellerId is { } currentUserId && currentUserId > 0)
        {
            var scoreMap = await _listingMatchService.EnsureScoresForFeedAsync(currentUserId, rows, cancellationToken);
            foreach (var row in rows)
            {
                if (scoreMap.TryGetValue(row.ListingId, out var score))
                {
                    row.MatchScore = score.Score;
                    row.MatchReason = score.Reason;
                }
            }

            rows = rows
                .OrderByDescending(r => r.MatchScore.HasValue)
                .ThenByDescending(r => r.MatchScore ?? int.MinValue)
                .ThenByDescending(r => r.CreatedAt)
                .ToList();
        }

        // Defensive: strip own seller_id again in case JWT + SQL ever drift.
        if (excludeSellerId is { } eid && eid > 0)
        {
            return Ok(rows.Where(r => r.SellerId != eid).ToList());
        }

        return Ok(rows);
    }

    /// <summary>Listings created by the logged-in user (seller_id = JWT user id).</summary>
    [Authorize]
    [HttpGet("mine")]
    [ProducesResponseType(typeof(IReadOnlyList<ListingFeedItemDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<ListingFeedItemDto>>> GetMine(
        [FromQuery] int limit = 48,
        CancellationToken cancellationToken = default)
    {
        if (limit < 1)
        {
            limit = 48;
        }

        if (limit > 200)
        {
            limit = 200;
        }

        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId) || userId <= 0)
        {
            return Unauthorized();
        }

        var rows = await _listings.GetMineAsync(userId, limit, cancellationToken);
        return Ok(rows.Where(r => r.SellerId == userId).ToList());
    }

    [Authorize]
    [HttpPost]
    [ProducesResponseType(typeof(ListingDetailDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<ListingDetailDto>> Create(
        [FromBody] CreateListingRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 150)
        {
            return BadRequest("Title is required (max 150 characters).");
        }

        if (string.IsNullOrWhiteSpace(request.ImageUrl))
        {
            return BadRequest("Listing image is required.");
        }

        if (request.ImageUrl.Length > 900_000)
        {
            return BadRequest("Image data is too large.");
        }

        if (request.Price < 0)
        {
            return BadRequest("Price cannot be negative.");
        }

        if (!string.IsNullOrWhiteSpace(request.Condition))
        {
            var c = request.Condition.Trim().ToLowerInvariant();
            if (c is not ("new" or "like_new" or "good" or "fair"))
            {
                return BadRequest("condition must be new, like_new, good, or fair.");
            }
        }

        if (request.Dimensions is { Length: > 120 })
        {
            return BadRequest("dimensions must be at most 120 characters.");
        }

        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId) || userId <= 0)
        {
            return Unauthorized();
        }

        if (await _users.IsUserOnProbationAsync(userId, cancellationToken))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                "This account is on administrative probation and cannot post or edit listings.");
        }

        var newId = await _listings.InsertAsync(userId, request, cancellationToken);
        if (newId is null)
        {
            return BadRequest("Could not create listing (user not found).");
        }

        var row = await _listings.GetByIdAsync(newId.Value, cancellationToken);
        if (row is null)
        {
            return BadRequest("Listing was created but could not be loaded.");
        }

        return CreatedAtAction(nameof(GetById), new { id = newId.Value }, row);
    }

    /// <summary>Update the seller&apos;s listing (same body as create).</summary>
    [Authorize]
    [HttpPut("{id:int}")]
    [ProducesResponseType(typeof(ListingDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ListingDetailDto>> Update(
        int id,
        [FromBody] CreateListingRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 150)
        {
            return BadRequest("Title is required (max 150 characters).");
        }

        if (string.IsNullOrWhiteSpace(request.ImageUrl))
        {
            return BadRequest("Listing image is required.");
        }

        if (request.ImageUrl.Length > 900_000)
        {
            return BadRequest("Image data is too large.");
        }

        if (request.Price < 0)
        {
            return BadRequest("Price cannot be negative.");
        }

        if (!string.IsNullOrWhiteSpace(request.Condition))
        {
            var c = request.Condition.Trim().ToLowerInvariant();
            if (c is not ("new" or "like_new" or "good" or "fair"))
            {
                return BadRequest("condition must be new, like_new, good, or fair.");
            }
        }

        if (request.Dimensions is { Length: > 120 })
        {
            return BadRequest("dimensions must be at most 120 characters.");
        }

        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId) || userId <= 0)
        {
            return Unauthorized();
        }

        if (await _users.IsUserOnProbationAsync(userId, cancellationToken))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                "This account is on administrative probation and cannot post or edit listings.");
        }

        var ok = await _listings.UpdateMineAsync(userId, id, request, cancellationToken);
        if (!ok)
        {
            return NotFound();
        }

        var row = await _listings.GetByIdAsync(id, cancellationToken);
        if (row is null)
        {
            return NotFound();
        }

        return Ok(row);
    }

    /// <summary>Soft-delete the seller&apos;s listing (<c>status = removed</c>).</summary>
    [Authorize]
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId) || userId <= 0)
        {
            return Unauthorized();
        }

        var ok = await _listings.DeleteMineAsync(userId, id, cancellationToken);
        return ok ? NoContent() : NotFound();
    }

    /// <summary>Listing detail plus reviews for this listing and the seller&apos;s overall rating (SPA).</summary>
    [AllowAnonymous]
    [HttpGet("{id:int}/context")]
    [ProducesResponseType(typeof(ListingDetailContextDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ListingDetailContextDto>> GetListingContext(int id, CancellationToken cancellationToken = default)
    {
        var listing = await _listings.GetByIdAsync(id, cancellationToken);
        if (listing is null)
        {
            return NotFound();
        }

        var listingReviews = await _ratings.GetForListingAsync(id, cancellationToken);
        var sellerRating = await _ratings.GetSummaryForUserAsync(listing.SellerId, cancellationToken);
        return Ok(new ListingDetailContextDto
        {
            Listing = listing,
            ListingReviews = listingReviews,
            SellerRatingSummary = sellerRating,
        });
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

    [AllowAnonymous]
    [HttpGet("{id:int}/match-reason")]
    [ProducesResponseType(typeof(ListingMatchReasonDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ListingMatchReasonDto>> GetMatchReason(
        int id,
        CancellationToken cancellationToken = default)
    {
        var row = await _listings.GetByIdAsync(id, cancellationToken);
        if (row is null)
        {
            return NotFound();
        }

        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        ListingMatchReasonDto? reason = null;
        if (int.TryParse(idRaw, out var userId) && userId > 0)
        {
            reason = await _listingMatchService.GetOrGenerateReasonAsync(userId, row, cancellationToken);
        }
        else
        {
            reason = await _listingMatchService.GenerateGuestReasonAsync(row, cancellationToken);
        }

        if (reason is null)
        {
            return NotFound();
        }

        return Ok(reason);
    }
}
