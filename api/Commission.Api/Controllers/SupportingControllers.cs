using System.Text.Json;
using Commission.Api.Data;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

// =====================================================================
// Approvals / Audit / Dashboard / Events / Slabs / Rules / Tags /
// Currencies / Trips / Perfect Store / Bulk Import
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
            SELECT ep.*, e.name AS employee_name, r.name AS role_name, cp.name AS plan_name
            FROM employee_payouts ep
            JOIN employees e ON ep.employee_id = e.id
            JOIN roles r ON e.role_id = r.id
            JOIN commission_plans cp ON ep.plan_id = cp.id
            {where}
            ORDER BY ep.created_at DESC LIMIT 200", new { status }));
    }

    public class ActionDto { public string Action { get; set; } = ""; public string? ActedBy { get; set; } public string? ActedByRole { get; set; } public string? Comments { get; set; } }

    [HttpPost("{payoutId}/action")]
    public async Task<IActionResult> Action(string payoutId, [FromBody] ActionDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync(
                "UPDATE employee_payouts SET approval_status = @s WHERE id = @id",
                new { s = dto.Action, id = payoutId }, t);
            await _db.ExecuteAsync(@"
                INSERT INTO approval_log (id, payout_id, action, acted_by, acted_by_role, comments)
                VALUES (@i, @p, @a, @b, @r, @c)",
                new { i = Guid.NewGuid().ToString(), p = payoutId, a = dto.Action, b = dto.ActedBy ?? "system", r = dto.ActedByRole, c = dto.Comments }, t);
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
        return Ok(await _db.QueryDynamicAsync($@"
            SELECT * FROM audit_trail {where} ORDER BY performed_at DESC LIMIT {lim}",
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
        var planCount       = await _db.QuerySingleOrDefaultAsync<long>("SELECT COUNT(*) FROM commission_plans WHERE status = 'active'");
        var employeeCount   = await _db.QuerySingleOrDefaultAsync<long>("SELECT COUNT(*) FROM employees WHERE is_active = 1");
        var kpiCount        = await _db.QuerySingleOrDefaultAsync<long>("SELECT COUNT(*) FROM kpi_definitions WHERE is_active = 1");
        var totalPayout = 0.0;
        long runCount = 0;
        if (!string.IsNullOrEmpty(period))
        {
            totalPayout = await _db.QuerySingleOrDefaultAsync<double>(
                "SELECT COALESCE(SUM(total_payout), 0) FROM calculation_runs WHERE period = @p AND is_simulation = 0",
                new { p = period });
            runCount = await _db.QuerySingleOrDefaultAsync<long>(
                "SELECT COUNT(*) FROM calculation_runs WHERE period = @p AND is_simulation = 0",
                new { p = period });
        }
        return Ok(new {
            plan_count = planCount, employee_count = employeeCount, kpi_count = kpiCount,
            total_payout = totalPayout, run_count = runCount
        });
    }

    [HttpGet("top-performers")]
    public async Task<IActionResult> TopPerformers([FromQuery] string period, [FromQuery] int? limit)
    {
        var lim = Math.Min(limit ?? 10, 100);
        return Ok(await _db.QueryDynamicAsync($@"
            SELECT ep.id, ep.net_payout, ep.gross_payout, ep.eligibility_status,
                   e.name AS employee_name, r.name AS role_name, cp.name AS plan_name,
                   t.name AS territory_name
            FROM employee_payouts ep
            JOIN employees e ON ep.employee_id = e.id
            JOIN roles r ON e.role_id = r.id
            JOIN commission_plans cp ON ep.plan_id = cp.id
            LEFT JOIN territories t ON e.territory_id = t.id
            WHERE ep.period = @period
            ORDER BY ep.net_payout DESC LIMIT {lim}", new { period }));
    }

    /// <summary>Per-employee dashboard for the salesperson persona.</summary>
    [HttpGet("salesperson/{employeeId}")]
    public async Task<IActionResult> Salesperson(string employeeId, [FromQuery] string period)
    {
        var employee = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
            SELECT e.id, e.name, e.email, e.base_salary, r.name AS role_name, t.name AS territory_name
            FROM employees e
            JOIN roles r ON e.role_id = r.id
            LEFT JOIN territories t ON e.territory_id = t.id
            WHERE e.id = @id", new { id = employeeId });
        if (employee is null) return NotFound(new { error = "Employee not found" });

        // Latest payout this period
        var payout = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
            SELECT ep.*, cp.name AS plan_name
            FROM employee_payouts ep
            JOIN commission_plans cp ON cp.id = ep.plan_id
            WHERE ep.employee_id = @e AND ep.period = @p
            ORDER BY ep.created_at DESC LIMIT 1",
            new { e = employeeId, p = period });

        IEnumerable<dynamic> kpiResults = Array.Empty<dynamic>();
        if (payout != null)
        {
            kpiResults = await _db.QueryDynamicAsync(@"
                SELECT kr.*, k.name AS kpi_name, k.code AS kpi_code, k.category AS kpi_category, k.unit
                FROM kpi_results kr
                JOIN kpi_definitions k ON k.id = kr.kpi_id
                WHERE kr.payout_id = @id ORDER BY kr.weight DESC, kr.weighted_payout DESC",
                new { id = (string)payout.id });
        }

        // Sales totals for this employee in this period
        var sales = await _db.QuerySingleOrDefaultAsync<double>(@"
            SELECT COALESCE(SUM(amount), 0) FROM transactions
            WHERE employee_id = @e AND period = @p AND transaction_type = 'sale'",
            new { e = employeeId, p = period });

        // Rank in this period vs all peers
        var rank = await _db.QuerySingleOrDefaultAsync<long>(@"
            SELECT COUNT(*) + 1 FROM employee_payouts
            WHERE period = @p AND net_payout > COALESCE((
                SELECT net_payout FROM employee_payouts WHERE employee_id = @e AND period = @p ORDER BY created_at DESC LIMIT 1
            ), 0)", new { e = employeeId, p = period });
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
    public async Task<IActionResult> List([FromQuery] string? planId)
    {
        var sql = planId == null ? "SELECT * FROM slab_sets" : "SELECT * FROM slab_sets WHERE plan_id = @p";
        var sets = (await _db.QueryDynamicAsync(sql, new { p = planId })).ToList();
        foreach (var s in sets)
            ((IDictionary<string, object?>)s)["tiers"] = await _db.QueryDynamicAsync(
                "SELECT * FROM slab_tiers WHERE slab_set_id = @s ORDER BY tier_order", new { s = (string)s.id });
        return Ok(sets);
    }
}

[ApiController]
[Route("api/tags")]
public class TagsController : ControllerBase
{
    private readonly IDb _db;
    public TagsController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await _db.QueryDynamicAsync("SELECT * FROM tags ORDER BY category, name"));
}

[ApiController]
[Route("api/currencies")]
public class CurrenciesController : ControllerBase
{
    private readonly IDb _db;
    public CurrenciesController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await _db.QueryDynamicAsync("SELECT * FROM currencies ORDER BY code"));

    [HttpGet("exchange-rates")]
    public async Task<IActionResult> Rates() =>
        Ok(await _db.QueryDynamicAsync("SELECT * FROM exchange_rates ORDER BY effective_date DESC"));
}

[ApiController]
[Route("api/events")]
public class EventsController : ControllerBase
{
    private readonly IDb _db;
    public EventsController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? period, [FromQuery] string? employeeId)
    {
        var clauses = new List<string>();
        if (period != null) clauses.Add("period = @p");
        if (employeeId != null) clauses.Add("employee_id = @e");
        var where = clauses.Count == 0 ? "" : " WHERE " + string.Join(" AND ", clauses);
        return Ok(await _db.QueryDynamicAsync(
            $"SELECT * FROM commission_events{where} ORDER BY event_date DESC LIMIT 500",
            new { p = period, e = employeeId }));
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
        var trips = (await _db.QueryDynamicAsync($"SELECT * FROM trips {where} ORDER BY trip_date DESC LIMIT 500", new { p = period })).ToList();
        foreach (var trip in trips)
            ((IDictionary<string, object?>)trip)["participants"] = await _db.QueryDynamicAsync(@"
                SELECT tp.*, e.name AS employee_name
                FROM trip_participants tp JOIN employees e ON tp.employee_id = e.id
                WHERE tp.trip_id = @t", new { t = (string)trip.id });
        return Ok(trips);
    }
}

[ApiController]
[Route("api/perfect-store")]
public class PerfectStoreController : ControllerBase
{
    private readonly IDb _db;
    public PerfectStoreController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? period, [FromQuery] string? employeeId)
    {
        var clauses = new List<string>();
        if (period != null) clauses.Add("period = @p");
        if (employeeId != null) clauses.Add("employee_id = @e");
        var where = clauses.Count == 0 ? "" : " WHERE " + string.Join(" AND ", clauses);
        return Ok(await _db.QueryDynamicAsync(
            $"SELECT * FROM perfect_store_audits{where} ORDER BY audited_at DESC LIMIT 500",
            new { p = period, e = employeeId }));
    }
}

[ApiController]
[Route("api/rules")]
public class RulesController : ControllerBase
{
    private readonly IDb _db;
    public RulesController(IDb db) { _db = db; }

    [HttpGet("plan/{planId}")]
    public async Task<IActionResult> Plan(string planId)
    {
        var ruleSets = (await _db.QueryDynamicAsync(
            "SELECT * FROM rule_sets WHERE plan_id = @p", new { p = planId })).ToList();
        foreach (var rs in ruleSets)
            ((IDictionary<string, object?>)rs)["rules"] = await _db.QueryDynamicAsync(
                "SELECT * FROM rules WHERE rule_set_id = @r ORDER BY priority", new { r = (string)rs.id });

        return Ok(new
        {
            rule_sets = ruleSets,
            eligibility = await _db.QueryDynamicAsync("SELECT * FROM eligibility_rules WHERE plan_id = @p", new { p = planId }),
            multipliers = await _db.QueryDynamicAsync("SELECT * FROM multiplier_rules WHERE plan_id = @p", new { p = planId }),
            penalties = await _db.QueryDynamicAsync("SELECT * FROM penalty_rules WHERE plan_id = @p", new { p = planId }),
            caps = await _db.QueryDynamicAsync("SELECT * FROM capping_rules WHERE plan_id = @p", new { p = planId }),
        });
    }
}

[ApiController]
[Route("api/bulk")]
public class BulkImportController : ControllerBase
{
    private readonly IDb _db;
    public BulkImportController(IDb db) { _db = db; }

    // Placeholder — CSV parsing intentionally minimal. Extend as needed.
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
                    INSERT INTO transactions (id, employee_id, customer_id, product_id, transaction_type,
                                              quantity, amount, transaction_date, period, territory_id)
                    VALUES (@id, @e, @c, @p, @tp, @q, @a, @dt, @per, @tr)",
                    new {
                        id = Guid.NewGuid().ToString(),
                        e = r.Fields.GetValueOrDefault("employee_id"),
                        c = r.Fields.GetValueOrDefault("customer_id"),
                        p = r.Fields.GetValueOrDefault("product_id"),
                        tp = r.Fields.GetValueOrDefault("transaction_type") ?? "sale",
                        q = r.Fields.GetValueOrDefault("quantity") ?? 0,
                        a = r.Fields.GetValueOrDefault("amount") ?? 0,
                        dt = r.Fields.GetValueOrDefault("transaction_date"),
                        per = r.Fields.GetValueOrDefault("period"),
                        tr = r.Fields.GetValueOrDefault("territory_id"),
                    }, t);
                count++;
            }
        });
        return Ok(new { imported = count });
    }
}
