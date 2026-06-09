using System.Text.Json;
using Commission.Api.Data;
using Commission.Api.Engine;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

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
            SELECT cr.uid, cr.plan_uid, cr.period, cr.status, cr.is_simulation,
                   cr.total_payout, cr.employee_count, cr.started_time, cr.completed_time,
                   cr.created_by, cp.name AS plan_name
            FROM calculation_runs cr
            JOIN commission_plans cp ON cr.plan_uid = cp.uid
            WHERE cr.is_simulation = FALSE
            ORDER BY cr.started_time DESC LIMIT {lim}");
        return Ok(rows);
    }

    [HttpGet("runs/{uid}")]
    public async Task<IActionResult> GetRun(string uid)
    {
        var run = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
            SELECT cr.*, cp.name AS plan_name
            FROM calculation_runs cr JOIN commission_plans cp ON cr.plan_uid = cp.uid
            WHERE cr.uid = @uid", new { uid });
        if (run is null) return NotFound(new { error = "Run not found" });

        var dict = (IDictionary<string, object?>)run;
        dict["payouts"] = await _db.QueryDynamicAsync(@"
            SELECT ep.*, e.name AS employee_name, e.role_name_en AS role_name, e.base_salary
            FROM employee_payouts ep
            JOIN employees e ON ep.emp_uid = e.uid
            WHERE ep.run_uid = @uid ORDER BY ep.net_payout DESC", new { uid });
        return Ok(dict);
    }

    [HttpGet("payouts/{uid}")]
    public async Task<IActionResult> GetPayout(string uid)
    {
        var payout = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
            SELECT ep.*, e.name AS employee_name, e.role_name_en AS role_name, e.base_salary
            FROM employee_payouts ep
            JOIN employees e ON ep.emp_uid = e.uid
            WHERE ep.uid = @uid", new { uid });
        if (payout is null) return NotFound(new { error = "Payout not found" });

        var dict = (IDictionary<string, object?>)payout;
        dict["kpi_results"] = await _db.QueryDynamicAsync(@"
            SELECT kr.*, k.name AS kpi_name, k.code AS kpi_code, k.category AS kpi_category, k.unit
            FROM kpi_results kr JOIN kpi_definitions k ON kr.kpi_uid = k.uid
            WHERE kr.payout_uid = @uid", new { uid });
        dict["approval_history"] = await _db.QueryDynamicAsync(
            "SELECT * FROM approval_log WHERE payout_uid = @uid ORDER BY created_time", new { uid });
        return Ok(dict);
    }

    public class RunDto
    {
        public string PlanUid { get; set; } = "";
        public string Period { get; set; } = "";
        public string? CreatedBy { get; set; }
        public string? EmpUid { get; set; }
        public Dictionary<string, JsonElement>? Overrides { get; set; }
    }

    [HttpPost("run")]
    public async Task<IActionResult> Run([FromBody] RunDto dto)
    {
        var overrides = dto.Overrides?.ToDictionary(
            kv => kv.Key,
            kv => (object?)kv.Value
        );

        // Auto-submit only when the run's period has ended.
        //   today is in the period & today < last day → stays as draft ('pending')
        //   today is in the period & today == last day → submitted (final monthly run)
        //   today is after the period (running last month manually) → submitted
        //   today is before the period (defensive) → draft
        bool autoSubmit = false;
        var parts = dto.Period?.Split('-');
        if (parts is { Length: 2 } &&
            int.TryParse(parts[0], out var py) &&
            int.TryParse(parts[1], out var pm) &&
            pm >= 1 && pm <= 12)
        {
            var lastDayOfPeriod = new DateTime(py, pm, DateTime.DaysInMonth(py, pm));
            autoSubmit = DateTime.UtcNow.Date >= lastDayOfPeriod;
        }

        var req = new PipelineRunRequest
        {
            PlanUid = dto.PlanUid,
            Period = dto.Period,
            CreatedBy = dto.CreatedBy,
            EmpUid = dto.EmpUid,
            IsSimulation = false,
            Overrides = overrides,
            ReplaceDraft = true,
            AutoSubmit = autoSubmit,
        };
        var result = await _pipeline.RunAsync(req);
        return Ok(result);
    }
}
