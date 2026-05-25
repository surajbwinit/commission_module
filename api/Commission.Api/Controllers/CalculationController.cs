using System.Text.Json;
using Commission.Api.Data;
using Commission.Api.Engine;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

/// <summary>Port of server/src/routes/calculation.js</summary>
[ApiController]
[Route("api/calculation")]
public class CalculationController : ControllerBase
{
    private readonly IDb _db;
    private readonly CalculationPipeline _pipeline;
    public CalculationController(IDb db, CalculationPipeline pipeline)
    {
        _db = db;
        _pipeline = pipeline;
    }

    [HttpGet("runs")]
    public async Task<IActionResult> ListRuns([FromQuery] int? limit)
    {
        var lim = Math.Min(limit ?? 50, 200);
        var rows = await _db.QueryDynamicAsync($@"
            SELECT cr.id, cr.plan_id, cr.period, cr.status, cr.is_simulation,
                   cr.total_payout, cr.employee_count, cr.started_at, cr.completed_at,
                   cr.created_by, cp.name AS plan_name
            FROM calculation_runs cr
            JOIN commission_plans cp ON cr.plan_id = cp.id
            WHERE cr.is_simulation = 0
            ORDER BY cr.started_at DESC LIMIT {lim}");
        return Ok(rows);
    }

    [HttpGet("runs/{id}")]
    public async Task<IActionResult> GetRun(string id)
    {
        var run = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
            SELECT cr.*, cp.name AS plan_name
            FROM calculation_runs cr JOIN commission_plans cp ON cr.plan_id = cp.id
            WHERE cr.id = @id", new { id });
        if (run is null) return NotFound(new { error = "Run not found" });

        var dict = (IDictionary<string, object?>)run;
        dict["payouts"] = await _db.QueryDynamicAsync(@"
            SELECT ep.*, e.name AS employee_name, r.name AS role_name, e.base_salary
            FROM employee_payouts ep
            JOIN employees e ON ep.employee_id = e.id
            JOIN roles r ON e.role_id = r.id
            WHERE ep.run_id = @id ORDER BY ep.net_payout DESC", new { id });
        return Ok(dict);
    }

    [HttpGet("payouts/{id}")]
    public async Task<IActionResult> GetPayout(string id)
    {
        var payout = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
            SELECT ep.*, e.name AS employee_name, r.name AS role_name, e.base_salary
            FROM employee_payouts ep
            JOIN employees e ON ep.employee_id = e.id
            JOIN roles r ON e.role_id = r.id
            WHERE ep.id = @id", new { id });
        if (payout is null) return NotFound(new { error = "Payout not found" });

        var dict = (IDictionary<string, object?>)payout;
        dict["kpi_results"] = await _db.QueryDynamicAsync(@"
            SELECT kr.*, k.name AS kpi_name, k.code AS kpi_code, k.category AS kpi_category, k.unit
            FROM kpi_results kr JOIN kpi_definitions k ON kr.kpi_id = k.id
            WHERE kr.payout_id = @id", new { id });
        dict["approval_history"] = await _db.QueryDynamicAsync(
            "SELECT * FROM approval_log WHERE payout_id = @id ORDER BY created_at", new { id });
        return Ok(dict);
    }

    public class RunDto
    {
        public string PlanId { get; set; } = "";
        public string Period { get; set; } = "";
        public string? CreatedBy { get; set; }
        public string? EmployeeId { get; set; }
        public Dictionary<string, JsonElement>? Overrides { get; set; }
    }

    [HttpPost("run")]
    public async Task<IActionResult> Run([FromBody] RunDto dto)
    {
        var overrides = dto.Overrides?.ToDictionary(
            kv => kv.Key,
            kv => (object?)kv.Value
        );
        var req = new PipelineRunRequest
        {
            PlanId = dto.PlanId,
            Period = dto.Period,
            CreatedBy = dto.CreatedBy,
            EmployeeId = dto.EmployeeId,
            IsSimulation = false,
            Overrides = overrides,
        };
        var result = await _pipeline.RunAsync(req);
        return Ok(result);
    }
}
