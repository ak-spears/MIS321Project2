using FullstackWithLlm.Api.Data;
using FullstackWithLlm.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace FullstackWithLlm.Api.Controllers;

[ApiController]
[Route("api/admin")]
public sealed class AdminController : ControllerBase
{
    private readonly AdminRepository _admin;
    private readonly IConfiguration _config;

    public AdminController(AdminRepository admin, IConfiguration config)
    {
        _admin = admin;
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
}

