using System.Text.Json;
using Commission.Api.Data;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

// =====================================================================
// Approvals / Audit / Dashboard / Slabs / Rules / Trips / Bulk Import
// All keys are uid. Tables dropped in the refactor (tags, currencies-old,
// commission_events, perfect_store_*) have no controllers here.
// =====================================================================

[ApiController]
[Route("api/approvals")]
public class ApprovalsController : ControllerBase
{
    private readonly IDb _db;
    public ApprovalsController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? status)
    {
        var where = status != null ? "WHERE ep.approval_status = @status" : "";
        return Ok(await _db.QueryDynamicAsync($@"
            SELECT ep.*, e.name AS employee_name, e.role_name_en AS role_name, cp.name AS plan_name
            FROM employee_payouts ep
            JOIN employees e ON ep.emp_uid = e.uid
            JOIN commission_plans cp ON ep.plan_uid = cp.uid
            {where}
            ORDER BY ep.created_time DESC LIMIT 200", new { status }));
    }

    public class ActionDto { public string Action { get; set; } = ""; public string? ActedBy { get; set; } public string? ActedByRole { get; set; } public string? Comments { get; set; } }

    [HttpPost("{payoutUid}/action")]
    public async Task<IActionResult> Action(string payoutUid, [FromBody] ActionDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync(
                "UPDATE employee_payouts SET approval_status = @s, modified_time = NOW() WHERE uid = @uid",
                new { s = dto.Action, uid = payoutUid }, t);
            await _db.ExecuteAsync(@"
                INSERT INTO approval_log (uid, payout_uid, action, acted_by, acted_by_role, comments, source_system)
                VALUES (@i, @p, @a, @b, @r, @c, 'manual')",
                new { i = Guid.NewGuid().ToString(), p = payoutUid, a = dto.Action,
                      b = dto.ActedBy ?? "system", r = dto.ActedByRole, c = dto.Comments }, t);
        });
        return Ok(new { success = true });
    }
}

[ApiController]
[Route("api/audit")]
public class AuditController : ControllerBase
{
    private readonly IDb _db;
    public AuditController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? entityType, [FromQuery] int? limit)
    {
        var lim = Math.Min(limit ?? 200, 1000);
        var where = entityType != null ? "WHERE entity_type = @t" : "";
        return Ok(await _db.QueryDynamicAsync(
            $"SELECT * FROM audit_trail {where} ORDER BY performed_time DESC LIMIT {lim}",
            new { t = entityType }));
    }
}

[ApiController]
[Route("api/dashboard")]
public class DashboardController : ControllerBase
{
    private readonly IDb _db;
    public DashboardController(IDb db) { _db = db; }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] string? period)
    {
        var planCount     = await _db.QuerySingleOrDefaultAsync<long>(
            "SELECT COUNT(*) FROM commission_plans WHERE status = 'active'");
        var employeeCount = await _db.QuerySingleOrDefaultAsync<long>(
            "SELECT COUNT(*) FROM employees WHERE is_active = TRUE");
        var kpiCount      = await _db.QuerySingleOrDefaultAsync<long>(
            "SELECT COUNT(*) FROM kpi_definitions WHERE is_active = TRUE");

        var totalPayout = 0.0;
        long runCount = 0;
        long earnersCount = 0, payoutPopulation = 0;
        double avgPayout = 0, medianPayout = 0;
        string? currencyCode = null;
        string? currencySymbol = null;

        if (!string.IsNullOrEmpty(period))
        {
            totalPayout = await _db.QuerySingleOrDefaultAsync<double>(
                "SELECT COALESCE(SUM(total_payout), 0) FROM calculation_runs WHERE period = @p AND is_simulation = FALSE",
                new { p = period });
            runCount = await _db.QuerySingleOrDefaultAsync<long>(
                "SELECT COUNT(*) FROM calculation_runs WHERE period = @p AND is_simulation = FALSE",
                new { p = period });

            // earners / population / avg / median — all from employee_payouts for the period
            var stats = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
                SELECT
                    COUNT(*)                                              AS population,
                    COUNT(*) FILTER (WHERE net_payout > 0)                AS earners,
                    COALESCE(AVG(net_payout), 0)                          AS avg_payout,
                    COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY net_payout), 0) AS median_payout
                FROM employee_payouts
                WHERE period = @p", new { p = period });
            if (stats != null)
            {
                payoutPopulation = (long)stats.population;
                earnersCount     = (long)stats.earners;
                avgPayout        = Convert.ToDouble(stats.avg_payout);
                medianPayout     = Convert.ToDouble(stats.median_payout);
            }

            // Pick a display currency only if all paying plans this period agree.
            // Otherwise leave null and the UI renders without a code (mixed-currency case).
            var currency = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
                WITH cur AS (
                    SELECT DISTINCT cp.currency_uid
                    FROM employee_payouts ep
                    JOIN commission_plans cp ON cp.uid = ep.plan_uid
                    WHERE ep.period = @p
                )
                SELECT c.code, c.symbol
                FROM cur
                JOIN currency c ON c.uid = cur.currency_uid
                WHERE (SELECT COUNT(*) FROM cur) = 1
                LIMIT 1", new { p = period });
            if (currency != null)
            {
                currencyCode   = (string?)currency.code;
                currencySymbol = (string?)currency.symbol;
            }
        }

        return Ok(new {
            plan_count        = planCount,
            employee_count    = employeeCount,
            kpi_count         = kpiCount,
            total_payout      = totalPayout,
            run_count         = runCount,
            earners_count     = earnersCount,
            payout_population = payoutPopulation,
            avg_payout        = avgPayout,
            median_payout     = medianPayout,
            currency_code     = currencyCode,
            currency_symbol   = currencySymbol,
        });
    }

    [HttpGet("top-performers")]
    public async Task<IActionResult> TopPerformers([FromQuery] string period, [FromQuery] int? limit)
    {
        var lim = Math.Min(limit ?? 10, 100);
        // Aggregate per employee — an employee on N plans would otherwise appear
        // N times in the leaderboard. We sum payouts across plans and list the
        // plans alongside as a comma-joined string for context.
        return Ok(await _db.QueryDynamicAsync($@"
            SELECT  MIN(ep.uid)                              AS uid,
                    ep.emp_uid                               AS emp_uid,
                    e.name                                   AS employee_name,
                    e.role_name_en                           AS role_name,
                    so.name                                  AS sales_office_name,
                    SUM(ep.net_payout)                       AS net_payout,
                    SUM(ep.gross_payout)                     AS gross_payout,
                    COUNT(*)                                 AS plan_count,
                    STRING_AGG(cp.name, ', ' ORDER BY cp.name) AS plan_name
            FROM employee_payouts ep
            JOIN employees e ON ep.emp_uid = e.uid
            JOIN commission_plans cp ON ep.plan_uid = cp.uid
            LEFT JOIN sales_offices so ON e.sales_office_uid = so.uid
            WHERE ep.period = @period
            GROUP BY ep.emp_uid, e.name, e.role_name_en, so.name
            ORDER BY SUM(ep.net_payout) DESC LIMIT {lim}", new { period }));
    }

    /// <summary>Per-employee dashboard for the salesperson persona.</summary>
    [HttpGet("salesperson/{empUid}")]
    public async Task<IActionResult> Salesperson(string empUid, [FromQuery] string period)
    {
        var employee = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
            SELECT e.uid, e.name, e.email, e.base_salary,
                   e.role_name_en AS role_name, so.name AS sales_office_name
            FROM employees e
            LEFT JOIN sales_offices so ON e.sales_office_uid = so.uid
            WHERE e.uid = @uid", new { uid = empUid });
        if (employee is null) return NotFound(new { error = "Employee not found" });

        var payout = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
            SELECT ep.*, cp.name AS plan_name
            FROM employee_payouts ep
            JOIN commission_plans cp ON cp.uid = ep.plan_uid
            WHERE ep.emp_uid = @e AND ep.period = @p
            ORDER BY ep.created_time DESC LIMIT 1",
            new { e = empUid, p = period });

        IEnumerable<dynamic> kpiResults = Array.Empty<dynamic>();
        if (payout != null)
        {
            kpiResults = await _db.QueryDynamicAsync(@"
                SELECT kr.*, k.name AS kpi_name, k.code AS kpi_code, k.category AS kpi_category, k.unit
                FROM kpi_results kr
                JOIN kpi_definitions k ON k.uid = kr.kpi_uid
                WHERE kr.payout_uid = @uid ORDER BY kr.weight DESC, kr.weighted_payout DESC",
                new { uid = (string)payout.uid });
        }

        var sales = await _db.QuerySingleOrDefaultAsync<double>(@"
            SELECT COALESCE(SUM(amount), 0) FROM transactions
            WHERE emp_uid = @e AND period = @p AND transaction_type = 'sale'",
            new { e = empUid, p = period });

        var rank = await _db.QuerySingleOrDefaultAsync<long>(@"
            SELECT COUNT(*) + 1 FROM employee_payouts
            WHERE period = @p AND net_payout > COALESCE((
                SELECT net_payout FROM employee_payouts WHERE emp_uid = @e AND period = @p ORDER BY created_time DESC LIMIT 1
            ), 0)", new { e = empUid, p = period });
        var totalPeers = await _db.QuerySingleOrDefaultAsync<long>(
            "SELECT COUNT(*) FROM employee_payouts WHERE period = @p", new { p = period });

        return Ok(new {
            employee, payout, kpi_results = kpiResults,
            total_sales = sales,
            rank, total_peers = totalPeers,
        });
    }
}

[ApiController]
[Route("api/slabs")]
public class SlabsController : ControllerBase
{
    private readonly IDb _db;
    public SlabsController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? planUid)
    {
        var sql = planUid == null
            ? "SELECT * FROM slab_sets"
            : "SELECT * FROM slab_sets WHERE plan_uid = @p";
        var sets = (await _db.QueryDynamicAsync(sql, new { p = planUid })).ToList();
        foreach (var s in sets)
            ((IDictionary<string, object?>)s)["tiers"] = await _db.QueryDynamicAsync(
                "SELECT * FROM slab_tiers WHERE slab_set_uid = @s ORDER BY tier_order",
                new { s = (string)s.uid });
        return Ok(sets);
    }
}

[ApiController]
[Route("api/trips")]
public class TripsController : ControllerBase
{
    private readonly IDb _db;
    public TripsController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? period)
    {
        var where = period != null ? "WHERE period = @p" : "";
        var trips = (await _db.QueryDynamicAsync(
            $"SELECT * FROM trips {where} ORDER BY trip_date DESC LIMIT 500",
            new { p = period })).ToList();
        foreach (var trip in trips)
            ((IDictionary<string, object?>)trip)["participants"] = await _db.QueryDynamicAsync(@"
                SELECT tp.*, e.name AS employee_name
                FROM trip_participants tp JOIN employees e ON tp.emp_uid = e.uid
                WHERE tp.trip_uid = @t", new { t = (string)trip.uid });
        return Ok(trips);
    }
}

[ApiController]
[Route("api/rules")]
public class RulesController : ControllerBase
{
    private readonly IDb _db;
    public RulesController(IDb db) { _db = db; }

    [HttpGet("plan/{planUid}")]
    public async Task<IActionResult> Plan(string planUid)
    {
        var ruleSets = (await _db.QueryDynamicAsync(
            "SELECT * FROM rule_sets WHERE plan_uid = @p", new { p = planUid })).ToList();
        foreach (var rs in ruleSets)
            ((IDictionary<string, object?>)rs)["rules"] = await _db.QueryDynamicAsync(
                "SELECT * FROM rules WHERE rule_set_uid = @r ORDER BY priority",
                new { r = (string)rs.uid });

        return Ok(new
        {
            rule_sets   = ruleSets,
            eligibility = await _db.QueryDynamicAsync("SELECT * FROM eligibility_rules WHERE plan_uid = @p", new { p = planUid }),
            multipliers = await _db.QueryDynamicAsync("SELECT * FROM multiplier_rules WHERE plan_uid = @p", new { p = planUid }),
            penalties   = await _db.QueryDynamicAsync("SELECT * FROM penalty_rules WHERE plan_uid = @p", new { p = planUid }),
            caps        = await _db.QueryDynamicAsync("SELECT * FROM capping_rules WHERE plan_uid = @p", new { p = planUid }),
        });
    }
}

[ApiController]
[Route("api/bulk")]
public class BulkImportController : ControllerBase
{
    private readonly IDb _db;
    public BulkImportController(IDb db) { _db = db; }

    public class BulkRow { public Dictionary<string, object?> Fields { get; set; } = new(); }

    [HttpPost("transactions")]
    public async Task<IActionResult> ImportTransactions([FromBody] List<BulkRow> rows)
    {
        var count = 0;
        await _db.InTransactionAsync(async (c, t) =>
        {
            foreach (var r in rows)
            {
                await _db.ExecuteAsync(@"
                    INSERT INTO transactions
                        (uid, emp_uid, customer_uid, product_uid, transaction_type,
                         quantity, amount, transaction_date, period, sales_office_uid, source_system)
                    VALUES (@uid, @e, @c, @p, @tp, @q, @a, @dt, @per, @sou, 'import')",
                    new {
                        uid = Guid.NewGuid().ToString(),
                        e   = r.Fields.GetValueOrDefault("emp_uid")         ?? r.Fields.GetValueOrDefault("employee_id"),
                        c   = r.Fields.GetValueOrDefault("customer_uid")    ?? r.Fields.GetValueOrDefault("customer_id"),
                        p   = r.Fields.GetValueOrDefault("product_uid")     ?? r.Fields.GetValueOrDefault("product_id"),
                        tp  = r.Fields.GetValueOrDefault("transaction_type") ?? "sale",
                        q   = r.Fields.GetValueOrDefault("quantity") ?? 0,
                        a   = r.Fields.GetValueOrDefault("amount")   ?? 0,
                        dt  = r.Fields.GetValueOrDefault("transaction_date"),
                        per = r.Fields.GetValueOrDefault("period"),
                        sou = r.Fields.GetValueOrDefault("sales_office_uid") ?? r.Fields.GetValueOrDefault("territory_id"),
                    }, t);
                count++;
            }
        });
        return Ok(new { imported = count });
    }
}
