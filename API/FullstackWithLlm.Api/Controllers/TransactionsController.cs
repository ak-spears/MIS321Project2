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

    public TransactionsController(TransactionRepository transactions)
    {
        _transactions = transactions;
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

    /// <summary>Seller&apos;s sales (same newest-first list; includes buyer id/name for pickup coordination).</summary>
    [HttpGet("sales")]
    [ProducesResponseType(typeof(IReadOnlyList<TransactionListItemDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<TransactionListItemDto>>> GetMySales(
        [FromQuery] int limit = 48,
        CancellationToken cancellationToken = default)
    {
        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId) || userId <= 0)
        {
            return Unauthorized();
        }

        var rows = await _transactions.GetMineAsSellerAsync(userId, limit, cancellationToken);
        return Ok(rows);
    }

    /// <summary>Complete checkout: creates a row in <c>transactions</c> and marks the listing <c>sold</c>.</summary>
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
    /// Buyer or seller confirms handoff done. Marks transaction completed once both sides confirm.
    /// </summary>
    [HttpPost("{transactionId:int}/confirm")]
    [ProducesResponseType(typeof(TransactionListItemDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TransactionListItemDto>> ConfirmCompletion(
        [FromRoute] int transactionId,
        CancellationToken cancellationToken = default)
    {
        if (transactionId <= 0)
        {
            return NotFound();
        }

        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId) || userId <= 0)
        {
            return Unauthorized();
        }

        var result = await _transactions.ConfirmCompletionAsync(transactionId, userId, cancellationToken);
        return result.Outcome switch
        {
            TransactionRepository.ConfirmCompletionOutcome.NotFound => NotFound("Transaction not found."),
            TransactionRepository.ConfirmCompletionOutcome.Forbidden => Forbid(),
            TransactionRepository.ConfirmCompletionOutcome.Conflict => Conflict("This transaction can’t be confirmed in its current state."),
            _ when result.Row is not null => Ok(result.Row),
            _ => StatusCode(StatusCodes.Status500InternalServerError, "Could not confirm transaction."),
        };
    }

    /// <summary>
    /// Seller-only: after prolonged inactivity, cancel the stale sale and relist the item as a donation (price 0, active).
    /// </summary>
    [HttpPost("{transactionId:int}/move-to-donations")]
    [ProducesResponseType(typeof(MoveTransactionToDonationResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<MoveTransactionToDonationResponse>> MoveToDonations(
        [FromRoute] int transactionId,
        CancellationToken cancellationToken = default)
    {
        if (transactionId <= 0)
        {
            return NotFound();
        }

        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId) || userId <= 0)
        {
            return Unauthorized();
        }

        var result = await _transactions.MoveStaleSaleToDonationAsync(transactionId, userId, 15, cancellationToken);
        return result.Outcome switch
        {
            TransactionRepository.MoveToDonationOutcome.NotFound => NotFound("Transaction not found."),
            TransactionRepository.MoveToDonationOutcome.Forbidden => Forbid(),
            TransactionRepository.MoveToDonationOutcome.Conflict => Conflict("This sale is not eligible to move yet (must be pending and inactive for 15+ days)."),
            _ => Ok(new MoveTransactionToDonationResponse
            {
                TransactionId = result.TransactionId,
                ListingId = result.ListingId,
                Status = "cancelled",
            }),
        };
    }

    /// <summary>
    /// Seller-only: cancel a pending transaction and relist the item as active so another buyer can purchase it.
    /// </summary>
    [HttpPost("{transactionId:int}/cancel-by-seller")]
    [ProducesResponseType(typeof(CancelTransactionResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<CancelTransactionResponse>> CancelBySeller(
        [FromRoute] int transactionId,
        CancellationToken cancellationToken = default)
    {
        if (transactionId <= 0)
        {
            return NotFound();
        }

        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(idRaw, out var userId) || userId <= 0)
        {
            return Unauthorized();
        }

        var result = await _transactions.CancelPendingBySellerAsync(transactionId, userId, cancellationToken);
        return result.Outcome switch
        {
            TransactionRepository.CancelBySellerOutcome.NotFound => NotFound("Transaction not found."),
            TransactionRepository.CancelBySellerOutcome.Forbidden => Forbid(),
            TransactionRepository.CancelBySellerOutcome.Conflict => Conflict("Only pending unconfirmed sales can be cancelled by seller."),
            _ => Ok(new CancelTransactionResponse
            {
                TransactionId = result.TransactionId,
                ListingId = result.ListingId,
                Status = "cancelled",
            }),
        };
    }
}
