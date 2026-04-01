using Microsoft.AspNetCore.Mvc;

namespace FullstackWithLlm.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class HealthController : ControllerBase
{
    [HttpGet]
    public ActionResult<object> Get() => Ok(new { status = "ok" });
}
