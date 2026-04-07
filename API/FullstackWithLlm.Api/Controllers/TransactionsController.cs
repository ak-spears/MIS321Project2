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

        return CreatedAtAction(nameof(GetMine), new { limit = 48 }, row);
    }
}
