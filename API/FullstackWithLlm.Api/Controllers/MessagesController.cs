using System.Security.Claims;
using FullstackWithLlm.Api.Data;
using FullstackWithLlm.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FullstackWithLlm.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class MessagesController : ControllerBase
{
    private readonly MessageRepository _messages;

    public MessagesController(MessageRepository messages)
    {
        _messages = messages;
    }

    [HttpGet("conversations")]
    [ProducesResponseType(typeof(IReadOnlyList<MessageConversationDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<MessageConversationDto>>> GetConversations(CancellationToken cancellationToken = default)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var rows = await _messages.GetForUserAsync(userId, cancellationToken);
        return Ok(rows);
    }

    [HttpPost("open")]
    [ProducesResponseType(typeof(MessageConversationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<MessageConversationDto>> OpenConversation(
        [FromBody] OpenConversationRequestDto request,
        CancellationToken cancellationToken = default)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        if (request.ListingId <= 0)
        {
            return BadRequest("A valid listing id is required.");
        }

        var row = await _messages.OpenAsync(userId, request, cancellationToken);
        if (row is null)
        {
            return BadRequest("Could not open a conversation for this listing.");
        }

        return Ok(row);
    }

    [HttpGet("conversations/{id}")]
    [ProducesResponseType(typeof(MessageConversationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<MessageConversationDto>> GetConversationById(
        string id,
        CancellationToken cancellationToken = default)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var row = await _messages.GetByIdForUserAsync(userId, id, cancellationToken);
        return row is null ? NotFound() : Ok(row);
    }

    [HttpPost("conversations/{id}/messages")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> SendMessage(
        string id,
        [FromBody] SendMessageRequestDto request,
        CancellationToken cancellationToken = default)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        if (string.IsNullOrWhiteSpace(request.Text))
        {
            return BadRequest("Message text is required.");
        }

        var ok = await _messages.AddMessageAsync(userId, id, request.Text, cancellationToken);
        return ok ? NoContent() : NotFound();
    }

    [HttpPost("conversations/{id}/read")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> MarkRead(string id, CancellationToken cancellationToken = default)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var ok = await _messages.MarkReadAsync(userId, id, cancellationToken);
        return ok ? NoContent() : NotFound();
    }

    private bool TryGetUserId(out int userId)
    {
        var idRaw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(idRaw, out userId) && userId > 0;
    }
}
