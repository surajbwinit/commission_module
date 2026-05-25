using System.Text.Json;
using Commission.Api.Engine;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

[ApiController]
[Route("api/simulation")]
public class SimulationController : ControllerBase
{
    private readonly CalculationPipeline _pipeline;
    public SimulationController(CalculationPipeline pipeline) { _pipeline = pipeline; }

    public class SimDto
    {
        public string PlanId { get; set; } = "";
        public string Period { get; set; } = "";
        public string? CreatedBy { get; set; }
        public Dictionary<string, JsonElement>? Overrides { get; set; }
    }

    [HttpPost("run")]
    public async Task<IActionResult> Run([FromBody] SimDto dto)
    {
        var overrides = dto.Overrides?.ToDictionary(kv => kv.Key, kv => (object?)kv.Value);
        var req = new PipelineRunRequest
        {
            PlanId = dto.PlanId,
            Period = dto.Period,
            CreatedBy = dto.CreatedBy,
            IsSimulation = true,
            Overrides = overrides,
        };
        var result = await _pipeline.RunAsync(req);
        return Ok(result);
    }
}
