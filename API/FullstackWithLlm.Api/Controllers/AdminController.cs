using FullstackWithLlm.Api.Data;
using FullstackWithLlm.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace FullstackWithLlm.Api.Controllers;

[ApiController]
[Route("api/admin")]
public sealed class AdminController : ControllerBase
{
    private readonly AdminRepository _admin;
    private readonly UserRepository _users;
    private readonly IConfiguration _config;

    public AdminController(AdminRepository admin, UserRepository users, IConfiguration config)
    {
        _admin = admin;
        _users = users;
        _config = config;
    }

    private bool IsAdminAuthed()
    {
        var expected = _config["Admin:Password"];
        if (string.IsNullOrWhiteSpace(expected))
        {
            expected = "password";
        }

        var provided = Request.Headers["X-Admin-Password"].ToString();
        return !string.IsNullOrWhiteSpace(provided) && provided == expected;
    }

    [HttpGet("dashboard")]
    [ProducesResponseType(typeof(AdminDashboardDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<AdminDashboardDto>> GetDashboard([FromQuery] int weeks = 12, CancellationToken cancellationToken = default)
    {
        if (!IsAdminAuthed())
        {
            return Unauthorized();
        }

        var dto = await _admin.GetDashboardAsync(weeks, cancellationToken);
        return Ok(dto);
    }

    /// <summary>Mark a user as on administrative probation (blocks new/edited listings) or clear it.</summary>
    [HttpPut("users/{id:int}/probation")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> SetUserProbation(
        int id,
        [FromBody] SetUserProbationRequestDto? body,
        CancellationToken cancellationToken = default)
    {
        if (!IsAdminAuthed())
        {
            return Unauthorized();
        }

        if (id <= 0 || body is null)
        {
            return BadRequest();
        }

        var ok = await _users.SetUserProbationAsync(id, body.OnProbation, cancellationToken);
        if (!ok)
        {
            return NotFound("User not found, or users.on_probation column is missing (run database/alter_users_on_probation.sql).");
        }

        return NoContent();
    }
}

