using System.Security.Claims;
using FullstackWithLlm.Api.Data;
using FullstackWithLlm.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FullstackWithLlm.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class UsersController : ControllerBase
{
    private static readonly HashSet<char> ValidSuiteLetters = new() { 'A', 'B', 'C', 'D' };

    private readonly UserRepository _users;
    private readonly ListingRepository _listings;
    private readonly RatingRepository _ratings;

    public UsersController(UserRepository users, ListingRepository listings, RatingRepository ratings)
    {
        _users = users;
        _listings = listings;
        _ratings = ratings;
    }

    [Authorize]
    [HttpGet("me")]
    [ProducesResponseType(typeof(UserProfileDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<UserProfileDto>> GetMe(CancellationToken cancellationToken)
    {
        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId) || userId <= 0)
        {
            return Unauthorized();
        }

        var profile = await _users.GetProfileByIdAsync(userId, cancellationToken);
        if (profile is null)
        {
            return NotFound();
        }

        return Ok(profile);
    }

    [Authorize]
    [HttpPut("me")]
    [ProducesResponseType(typeof(UserProfileDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<UserProfileDto>> UpdateMe([FromBody] UpdateUserProfileRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.DisplayName) || request.DisplayName.Trim().Length > 60)
        {
            return BadRequest("Display name is required (max 60 chars).");
        }

        if (string.IsNullOrWhiteSpace(request.Phone))
        {
            return BadRequest("Phone is required.");
        }

        if (!DateTime.TryParse(request.MoveInDate, out _))
        {
            return BadRequest("Move-in date must be a valid date (use yyyy-MM-dd).");
        }

        if (!string.IsNullOrWhiteSpace(request.MoveOutDate) && !DateTime.TryParse(request.MoveOutDate, out _))
        {
            return BadRequest("Move-out date must be a valid date (use yyyy-MM-dd) or empty.");
        }

        if (!string.IsNullOrWhiteSpace(request.SuiteLetter))
        {
            var s = request.SuiteLetter.Trim().ToUpperInvariant();
            if (s.Length != 1 || !ValidSuiteLetters.Contains(s[0]))
            {
                return BadRequest("Suite letter must be A, B, C, or D.");
            }
        }

        if (request.AvatarUrl is { Length: > 800_000 })
        {
            return BadRequest("Avatar value is too large.");
        }

        if (!string.IsNullOrWhiteSpace(request.DefaultGapSolution))
        {
            var g = request.DefaultGapSolution.Trim().ToLowerInvariant();
            if (g is not ("storage" or "pickup_window" or "ship_or_deliver"))
            {
                return BadRequest("defaultGapSolution must be storage, pickup_window, or ship_or_deliver.");
            }
        }

        if (!string.IsNullOrWhiteSpace(request.PreferredReceiveGap))
        {
            var g = request.PreferredReceiveGap.Trim().ToLowerInvariant();
            if (g is not ("storage" or "pickup_window" or "ship_or_deliver"))
            {
                return BadRequest("preferredReceiveGap must be storage, pickup_window, or ship_or_deliver.");
            }
        }

        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId) || userId <= 0)
        {
            return Unauthorized();
        }

        bool updated;
        try
        {
            updated = await _users.UpdateProfileAsync(userId, request, cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
        if (!updated)
        {
            return NotFound();
        }

        var profile = await _users.GetProfileByIdAsync(userId, cancellationToken);
        if (profile is null)
        {
            return NotFound();
        }

        return Ok(profile);
    }

    [HttpGet("{id:int}/public")]
    [ProducesResponseType(typeof(PublicUserProfileDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PublicUserProfileDto>> GetPublicProfile(int id, CancellationToken cancellationToken)
    {
        if (id <= 0)
        {
            return NotFound();
        }

        var profile = await _users.GetPublicProfileByIdAsync(id, cancellationToken);
        if (profile is null)
        {
            return NotFound();
        }

        return Ok(profile);
    }

    [AllowAnonymous]
    [HttpGet("{id:int}/seller")]
    [ProducesResponseType(typeof(SellerProfileDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<SellerProfileDto>> GetSellerProfile(
        int id,
        [FromQuery] int listingLimit = 60,
        [FromQuery] int reviewLimit = 20,
        [FromQuery] int minRatingsForPercentile = 1,
        CancellationToken cancellationToken = default)
    {
        if (id <= 0)
        {
            return NotFound();
        }

        if (minRatingsForPercentile < 1)
        {
            minRatingsForPercentile = 1;
        }

        if (minRatingsForPercentile > 50)
        {
            minRatingsForPercentile = 50;
        }

        var user = await _users.GetSellerProfileByIdAsync(id, cancellationToken);
        if (user is null)
        {
            return NotFound();
        }

        var listings = await _listings.GetMineAsync(id, listingLimit, cancellationToken);
        var rating = await _ratings.GetSummaryForUserAsync(id, cancellationToken);
        var reviews = await _ratings.GetRecentForUserAsync(id, reviewLimit, cancellationToken);
        var (pct, peerSellers) = await _ratings.GetSellerAverageRatingPercentileAmongSellersAsync(
            id,
            minRatingsForPercentile,
            cancellationToken);

        return Ok(new SellerProfileDto
        {
            User = user,
            Listings = listings,
            Rating = rating,
            Reviews = reviews,
            RatingAveragePercentile = pct,
            RatingPercentilePeerSellerCount = peerSellers,
        });
    }
}

