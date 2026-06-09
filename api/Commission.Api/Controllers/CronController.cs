using Commission.Api.Data;
using Commission.Api.Scheduler;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

[ApiController]
[Route("api/cron")]
public class CronController : ControllerBase
{
    private readonly DailyCronService _cron;
    private readonly IDb _db;
    public CronController(DailyCronService cron, IDb db) { _cron = cron; _db = db; }

    /// <summary>Status of the daily cron — what plans it touches, what payouts are still in draft.</summary>
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var activeMonthly = await _db.QueryDynamicAsync(
            "SELECT uid, name FROM commission_plans WHERE status = 'active' AND plan_type = 'monthly' ORDER BY name");
        var drafts = await _db.QueryDynamicAsync(@"
            SELECT period, COUNT(*) AS draft_count, SUM(net_payout) AS draft_total
            FROM employee_payouts
            WHERE approval_status = 'draft'
            GROUP BY period ORDER BY period DESC");
        var lastRuns = await _db.QueryDynamicAsync(@"
            SELECT cr.plan_uid, cp.name AS plan_name, cr.period, cr.started_time,
                   cr.total_payout, cr.employee_count
            FROM calculation_runs cr
            JOIN commission_plans cp ON cp.uid = cr.plan_uid
            WHERE cr.created_by = 'cron'
            ORDER BY cr.started_time DESC LIMIT 20");

        return Ok(new
        {
            today                = DateTime.UtcNow.ToString("yyyy-MM-dd"),
            current_period       = DateTime.UtcNow.ToString("yyyy-MM"),
            active_monthly_plans = activeMonthly,
            drafts_by_period     = drafts,
            recent_cron_runs     = lastRuns,
        });
    }

    /// <summary>Manually trigger a cron pass (useful for testing / on-demand re-run).</summary>
    [HttpPost("run-now")]
    public async Task<IActionResult> RunNow(CancellationToken ct)
    {
        await _cron.RunOnceAsync(ct);
        return Ok(new { success = true });
    }
}
