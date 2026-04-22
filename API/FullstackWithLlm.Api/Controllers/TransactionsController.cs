using System.Security.Claims;
using FullstackWithLlm.Api.Data;
using FullstackWithLlm.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FullstackWithLlm.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class TransactionsController : ControllerBase
{
    private readonly TransactionRepository _transactions;
    private readonly RatingRepository _ratings;

    public TransactionsController(TransactionRepository transactions, RatingRepository ratings)
    {
        _transactions = transactions;
        _ratings = ratings;
    }

    /// <summary>Buyer&apos;s transactions (paid buys and free claims), newest first.</summary>
    [HttpGet("mine")]
    [ProducesResponseType(typeof(IReadOnlyList<TransactionListItemDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<TransactionListItemDto>>> GetMine(
        [FromQuery] int limit = 48,
        CancellationToken cancellationToken = default)
    {
        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId) || userId <= 0)
        {
            return Unauthorized();
        }

        var rows = await _transactions.GetMineAsBuyerAsync(userId, limit, cancellationToken);
        return Ok(rows);
    }

    /// <summary>Seller's in-progress (claimed) sales, newest first.</summary>
    [HttpGet("selling")]
    [ProducesResponseType(typeof(IReadOnlyList<SellerSaleListItemDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<SellerSaleListItemDto>>> GetSelling(
        [FromQuery] int limit = 48,
        CancellationToken cancellationToken = default)
    {
        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var sellerId) || sellerId <= 0)
        {
            return Unauthorized();
        }

        var rows = await _transactions.GetMineAsSellerAsync(sellerId, limit, cancellationToken);
        return Ok(rows);
    }

    /// <summary>Checkout: creates a row in <c>transactions</c> and marks the listing <c>claimed</c> (reserved).</summary>
    [HttpPost]
    [ProducesResponseType(typeof(TransactionListItemDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TransactionListItemDto>> Create(
        [FromBody] CreateTransactionRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.ListingId <= 0)
        {
            return BadRequest("A valid listing id is required.");
        }

        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var buyerId) || buyerId <= 0)
        {
            return Unauthorized();
        }

        var row = await _transactions.CreateCheckoutAsync(
            buyerId,
            request.ListingId,
            request.PaymentMethod,
            cancellationToken);

        if (row is null)
        {
            return Conflict(
                "That listing is not available to buy or claim. It may be sold, removed, or yours already.");
        }

        // Explicit 201 + body so clients always receive transactionId (CreatedAtAction can omit body in some setups).
        return StatusCode(StatusCodes.Status201Created, row);
    }

    /// <summary>
    /// Buyer marks item received: completes the pending transaction and flips the listing to sold.
    /// This is when an eventual payment capture would occur in a real processor integration.
    /// </summary>
    [HttpPost("{id:int}/complete")]
    [ProducesResponseType(typeof(TransactionListItemDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TransactionListItemDto>> CompleteOnReceipt(
        int id,
        CancellationToken cancellationToken = default)
    {
        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var buyerId) || buyerId <= 0)
        {
            return Unauthorized();
        }

        var row = await _transactions.CompleteOnReceiptAsync(buyerId, id, cancellationToken);
        if (row is null)
        {
            return Conflict("That transaction cannot be completed (not pending, not yours, or listing not claimed).");
        }

        return Ok(row);
    }

    /// <summary>Buyer releases claim: cancels the pending transaction and flips the listing back to active.</summary>
    [HttpPost("{id:int}/release")]
    [ProducesResponseType(typeof(TransactionListItemDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TransactionListItemDto>> ReleaseClaim(
        int id,
        CancellationToken cancellationToken = default)
    {
        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var buyerId) || buyerId <= 0)
        {
            return Unauthorized();
        }

        var row = await _transactions.ReleaseClaimAsync(buyerId, id, cancellationToken);
        if (row is null)
        {
            return Conflict("That claim cannot be released (not pending, not yours, or listing not claimed).");
        }

        return Ok(row);
    }

    /// <summary>Buyer rates the seller after completion (one review per transaction/listing pair).</summary>
    [HttpPost("{id:int}/rating")]
    [ProducesResponseType(typeof(UserRatingDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<UserRatingDto>> CreateRating(
        int id,
        [FromBody] CreateTransactionRatingRequestDto request,
        CancellationToken cancellationToken = default)
    {
        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var buyerId) || buyerId <= 0)
        {
            return Unauthorized();
        }

        var score = request.Score;
        if (score is < 1 or > 5)
        {
            return BadRequest("Score must be between 1 and 5.");
        }

        var comment = request.Comment;
        if (comment != null)
        {
            comment = comment.Trim();
            if (comment.Length == 0) comment = null;
            if (comment != null && comment.Length > 500) comment = comment[..500];
        }

        var created = await _ratings.CreateForCompletedTransactionAsync(buyerId, id, score, comment, cancellationToken);
        if (created is null)
        {
            return Conflict("That rating cannot be saved (not completed, not yours, or already rated).");
        }

        return StatusCode(StatusCodes.Status201Created, created);
    }
}
