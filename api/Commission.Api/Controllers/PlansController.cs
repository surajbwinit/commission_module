using System.Text.Json;
using Commission.Api.Data;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

/// <summary>
/// Plan CRUD + sub-resource replace endpoints (roles / sales-offices / employees /
/// kpis / slabs / rules / eligibility / multipliers / kpi-deductions / penalties /
/// caps / splits / monthly-targets / fixed-incentives).
///
/// All keys are uid. Route param {id} is the plan uid; internal SQL uses
/// `commission_plans.uid` (not the bigserial `id`).
/// </summary>
[ApiController]
[Route("api/plans")]
public class PlansController : ControllerBase
{
    private readonly IDb _db;
    public PlansController(IDb db) { _db = db; }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        var plans = (await _db.QueryDynamicAsync(@"
            SELECT cp.*,
                cur.code AS currency_code, cur.symbol AS currency_symbol,
                COALESCE((SELECT COUNT(*) FROM plan_kpis           WHERE plan_uid = cp.uid), 0) AS kpi_count,
                COALESCE((SELECT COUNT(*) FROM plan_sales_offices  WHERE plan_uid = cp.uid), 0) AS sales_office_count
            FROM commission_plans cp
            LEFT JOIN currency cur ON cur.uid = cp.currency_uid
            ORDER BY cp.created_time DESC")).ToList();

        var allRoles = (await _db.QueryDynamicAsync(@"
            SELECT pr.plan_uid, r.uid, r.role_name_en, r.code
            FROM plan_roles pr JOIN roles r ON pr.role_uid = r.uid")).ToList();
        var rolesByPlan = new Dictionary<string, List<object>>();
        foreach (var r in allRoles)
        {
            string pid = r.plan_uid;
            if (!rolesByPlan.TryGetValue(pid, out var list)) { list = new(); rolesByPlan[pid] = list; }
            list.Add(new { uid = (string)r.uid, code = (string?)r.code, name = (string)r.role_name_en });
        }

        var enriched = plans.Select(p =>
        {
            var dict = (IDictionary<string, object?>)p;
            dict["roles"] = rolesByPlan.TryGetValue((string)p.uid, out var rs) ? rs : new List<object>();
            return dict;
        });
        return Ok(enriched);
    }

    [HttpGet("{uid}")]
    public async Task<IActionResult> Get(string uid)
    {
        var plan = await _db.QuerySingleOrDefaultAsync<dynamic>(@"
            SELECT cp.*, cur.code AS currency_code, cur.symbol AS currency_symbol
            FROM commission_plans cp
            LEFT JOIN currency cur ON cur.uid = cp.currency_uid
            WHERE cp.uid = @uid", new { uid });
        if (plan is null) return NotFound(new { error = "Plan not found" });

        var dict = (IDictionary<string, object?>)plan;
        dict["roles"] = await _db.QueryDynamicAsync(@"
            SELECT r.* FROM plan_roles pr JOIN roles r ON pr.role_uid = r.uid
            WHERE pr.plan_uid = @uid", new { uid });
        dict["sales_offices"] = await _db.QueryDynamicAsync(@"
            SELECT so.* FROM plan_sales_offices pso
            JOIN sales_offices so ON pso.sales_office_uid = so.uid
            WHERE pso.plan_uid = @uid", new { uid });
        dict["employees"] = await _db.QueryDynamicAsync(@"
            SELECT e.uid, e.emp_code, e.name, e.email,
                   e.role_uid, e.role_code, e.role_name_en,
                   e.sales_office_uid, e.sales_office_name
            FROM plan_employees pe
            JOIN employees e ON pe.emp_uid = e.uid
            WHERE pe.plan_uid = @uid
            ORDER BY e.name", new { uid });
        dict["kpis"] = await _db.QueryDynamicAsync(@"
            SELECT pk.*, k.name AS kpi_name, k.code AS kpi_code, k.category AS kpi_category,
                   k.formula, k.unit, k.direction
            FROM plan_kpis pk JOIN kpi_definitions k ON pk.kpi_uid = k.uid
            WHERE pk.plan_uid = @uid", new { uid });

        var slabSets = (await _db.QueryDynamicAsync(@"
            SELECT ss.*, r.role_name_en AS role_name FROM slab_sets ss
            LEFT JOIN roles r ON r.uid = ss.role_uid
            WHERE ss.plan_uid = @uid", new { uid })).ToList();
        foreach (var ss in slabSets)
        {
            ((IDictionary<string, object?>)ss)["tiers"] = await _db.QueryDynamicAsync(
                "SELECT * FROM slab_tiers WHERE slab_set_uid = @s ORDER BY tier_order",
                new { s = (string)ss.uid });
        }
        dict["slab_sets"] = slabSets;

        var ruleSets = (await _db.QueryDynamicAsync(
            "SELECT * FROM rule_sets WHERE plan_uid = @uid", new { uid })).ToList();
        foreach (var rs in ruleSets)
            ((IDictionary<string, object?>)rs)["rules"] = await _db.QueryDynamicAsync(
                "SELECT * FROM rules WHERE rule_set_uid = @r", new { r = (string)rs.uid });
        dict["rule_sets"] = ruleSets;

        dict["eligibility_rules"] = await _db.QueryDynamicAsync(
            "SELECT * FROM eligibility_rules WHERE plan_uid = @uid", new { uid });
        dict["multiplier_rules"] = await _db.QueryDynamicAsync(
            "SELECT * FROM multiplier_rules WHERE plan_uid = @uid", new { uid });
        dict["kpi_deduction_rules"] = await _db.QueryDynamicAsync(@"
            SELECT kdr.*, kd.name AS kpi_name, kd.code AS kpi_code, r.role_name_en AS role_name
            FROM kpi_deduction_rules kdr
            LEFT JOIN kpi_definitions kd ON kd.uid = kdr.kpi_uid
            LEFT JOIN roles r ON r.uid = kdr.role_uid
            WHERE kdr.plan_uid = @uid ORDER BY kdr.priority, kdr.created_time", new { uid });
        dict["penalty_rules"] = await _db.QueryDynamicAsync(
            "SELECT * FROM penalty_rules WHERE plan_uid = @uid", new { uid });
        dict["monthly_targets"] = await _db.QueryDynamicAsync(@"
            SELECT t.*, k.name AS kpi_name, k.code AS kpi_code, r.role_name_en AS role_name
            FROM plan_kpi_monthly_targets t
            JOIN kpi_definitions k ON k.uid = t.kpi_uid
            LEFT JOIN roles r ON r.uid = t.role_uid
            WHERE t.plan_uid = @uid ORDER BY t.period, t.kpi_uid", new { uid });
        dict["fixed_incentives"] = await _db.QueryDynamicAsync(@"
            SELECT fi.*, k.name AS condition_kpi_name, r.role_name_en AS role_name
            FROM plan_fixed_incentives fi
            LEFT JOIN kpi_definitions k ON k.uid = fi.condition_kpi_uid
            LEFT JOIN roles r ON r.uid = fi.role_uid
            WHERE fi.plan_uid = @uid ORDER BY fi.period, fi.name", new { uid });
        dict["capping_rules"] = await _db.QueryDynamicAsync(
            "SELECT * FROM capping_rules WHERE plan_uid = @uid", new { uid });

        var splitRules = (await _db.QueryDynamicAsync(
            "SELECT * FROM split_rules WHERE plan_uid = @uid", new { uid })).ToList();
        foreach (var sr in splitRules)
            ((IDictionary<string, object?>)sr)["participants"] = await _db.QueryDynamicAsync(@"
                SELECT sp.*, r.role_name_en AS role_name FROM split_participants sp
                JOIN roles r ON sp.role_uid = r.uid WHERE sp.split_rule_uid = @s",
                new { s = (string)sr.uid });
        dict["split_rules"] = splitRules;

        return Ok(dict);
    }

    public class CreatePlanDto
    {
        public string? Name { get; set; }
        public string? Description { get; set; }
        public string? PlanType { get; set; }
        public DateTime EffectiveFrom { get; set; }
        public DateTime EffectiveTo { get; set; }
        public double BasePayout { get; set; }
        public string? CurrencyUid { get; set; }
        public string? OrgUid { get; set; }
        public string? CreatedBy { get; set; }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreatePlanDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.CurrencyUid))
            return BadRequest(new { error = "currency_uid is required. Pick a currency from /api/currency before creating a plan." });

        // Verify the currency actually exists
        var currencyExists = await _db.QuerySingleOrDefaultAsync<string>(
            "SELECT uid FROM currency WHERE uid = @uid", new { uid = dto.CurrencyUid });
        if (currencyExists is null)
            return BadRequest(new { error = $"Currency '{dto.CurrencyUid}' not found in the currency table." });

        var uid = Guid.NewGuid().ToString();
        await _db.ExecuteAsync(@"
            INSERT INTO commission_plans
                (uid, org_uid, name, description, plan_type, effective_from, effective_to,
                 base_payout, currency_uid, created_by, source_system)
            VALUES (@uid, @org, @name, @desc, @type, @from, @to, @base, @cur, @by, 'manual')",
            new {
                uid, org = dto.OrgUid, name = dto.Name, desc = dto.Description,
                type = dto.PlanType ?? "monthly",
                from = dto.EffectiveFrom, to = dto.EffectiveTo,
                @base = dto.BasePayout, cur = dto.CurrencyUid,
                by = dto.CreatedBy
            });
        await _db.ExecuteAsync(@"
            INSERT INTO audit_trail (uid, entity_type, entity_uid, action, changes, performed_by, source_system)
            VALUES (@uid, 'plan', @eid, 'created', @ch::jsonb, @by, 'manual')",
            new {
                uid = Guid.NewGuid().ToString(), eid = uid,
                ch = JsonSerializer.Serialize(new { name = dto.Name }),
                by = dto.CreatedBy
            });
        var plan = await _db.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT * FROM commission_plans WHERE uid = @uid", new { uid });
        return StatusCode(201, plan);
    }

    public class UpdatePlanDto : CreatePlanDto { public string? Status { get; set; } public string? UpdatedBy { get; set; } }

    [HttpPut("{uid}")]
    public async Task<IActionResult> Update(string uid, [FromBody] UpdatePlanDto dto)
    {
        var existing = await _db.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT uid FROM commission_plans WHERE uid = @uid", new { uid });
        if (existing is null) return NotFound(new { error = "Plan not found" });

        await _db.ExecuteAsync(@"
            UPDATE commission_plans SET
                name = COALESCE(@name, name),
                description = COALESCE(@desc, description),
                status = COALESCE(@status, status),
                plan_type = COALESCE(@type, plan_type),
                effective_from = COALESCE(@from, effective_from),
                effective_to = COALESCE(@to, effective_to),
                base_payout = COALESCE(@base, base_payout),
                currency_uid = COALESCE(@cur, currency_uid),
                org_uid = COALESCE(@org, org_uid),
                modified_by = COALESCE(@by, modified_by),
                modified_time = NOW()
            WHERE uid = @uid",
            new {
                uid, name = dto.Name, desc = dto.Description, status = dto.Status,
                type = dto.PlanType,
                from = (DateTime?)(dto.EffectiveFrom == default ? null : dto.EffectiveFrom),
                to   = (DateTime?)(dto.EffectiveTo   == default ? null : dto.EffectiveTo),
                @base = (double?)(dto.BasePayout == 0 ? null : dto.BasePayout),
                cur = dto.CurrencyUid, org = dto.OrgUid, by = dto.UpdatedBy
            });

        // Audit only the fields that were actually supplied, in snake_case, no nulls.
        // Default DateTime / 0 BasePayout means "not changed" in this PATCH semantics.
        var changes = new Dictionary<string, object?>();
        if (!string.IsNullOrEmpty(dto.Name))         changes["name"] = dto.Name;
        if (!string.IsNullOrEmpty(dto.Description))  changes["description"] = dto.Description;
        if (!string.IsNullOrEmpty(dto.Status))       changes["status"] = dto.Status;
        if (!string.IsNullOrEmpty(dto.PlanType))     changes["plan_type"] = dto.PlanType;
        if (!string.IsNullOrEmpty(dto.CurrencyUid))  changes["currency_uid"] = dto.CurrencyUid;
        if (!string.IsNullOrEmpty(dto.OrgUid))       changes["org_uid"] = dto.OrgUid;
        if (dto.EffectiveFrom != default)            changes["effective_from"] = dto.EffectiveFrom.ToString("yyyy-MM-dd");
        if (dto.EffectiveTo   != default)            changes["effective_to"]   = dto.EffectiveTo.ToString("yyyy-MM-dd");
        if (dto.BasePayout    != 0)                  changes["base_payout"] = dto.BasePayout;

        await _db.ExecuteAsync(@"
            INSERT INTO audit_trail (uid, entity_type, entity_uid, action, changes, performed_by, source_system)
            VALUES (@uid, 'plan', @eid, 'updated', @ch::jsonb, @by, 'manual')",
            new {
                uid = Guid.NewGuid().ToString(), eid = uid,
                ch = JsonSerializer.Serialize(changes),
                by = dto.UpdatedBy ?? "system"
            });

        var updated = await _db.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT * FROM commission_plans WHERE uid = @uid", new { uid });
        return Ok(updated);
    }

    // ===== Sub-resources (all full-replace) =====

    public class RoleUidsDto { public List<string> RoleUids { get; set; } = new(); }

    [HttpPut("{uid}/roles")]
    public async Task<IActionResult> UpdateRoles(string uid, [FromBody] RoleUidsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_roles WHERE plan_uid = @uid", new { uid }, t);
            foreach (var roleUid in dto.RoleUids)
                await _db.ExecuteAsync(
                    "INSERT INTO plan_roles (uid, plan_uid, role_uid, source_system) VALUES (@i, @p, @r, 'manual')",
                    new { i = Guid.NewGuid().ToString(), p = uid, r = roleUid }, t);
        });
        return Ok(new { success = true });
    }

    public class SalesOfficeUidsDto { public List<string> SalesOfficeUids { get; set; } = new(); }

    [HttpPut("{uid}/sales-offices")]
    public async Task<IActionResult> UpdateSalesOffices(string uid, [FromBody] SalesOfficeUidsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_sales_offices WHERE plan_uid = @uid", new { uid }, t);
            foreach (var officeUid in dto.SalesOfficeUids)
                await _db.ExecuteAsync(
                    "INSERT INTO plan_sales_offices (uid, plan_uid, sales_office_uid, source_system) VALUES (@i, @p, @o, 'manual')",
                    new { i = Guid.NewGuid().ToString(), p = uid, o = officeUid }, t);
        });
        return Ok(new { success = true });
    }

    public class EmpUidsDto { public List<string> EmpUids { get; set; } = new(); }

    /// <summary>
    /// Optional whitelist. Empty list = no employee restriction; the plan applies
    /// to every employee that matches plan_roles + plan_sales_offices.
    /// Non-empty list = narrow further to just these employees.
    /// </summary>
    [HttpPut("{uid}/employees")]
    public async Task<IActionResult> UpdateEmployees(string uid, [FromBody] EmpUidsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_employees WHERE plan_uid = @uid", new { uid }, t);
            foreach (var empUid in dto.EmpUids)
                await _db.ExecuteAsync(
                    "INSERT INTO plan_employees (uid, plan_uid, emp_uid, source_system) VALUES (@i, @p, @e, 'manual')",
                    new { i = Guid.NewGuid().ToString(), p = uid, e = empUid }, t);
        });
        return Ok(new { success = true });
    }

    public class PlanKpiInput { public string KpiUid { get; set; } = ""; public double Weight { get; set; } public double TargetValue { get; set; } public string? SlabSetUid { get; set; } }
    public class PlanKpisDto { public List<PlanKpiInput> Kpis { get; set; } = new(); }

    [HttpPut("{uid}/kpis")]
    public async Task<IActionResult> UpdateKpis(string uid, [FromBody] PlanKpisDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_kpis WHERE plan_uid = @uid", new { uid }, t);
            foreach (var k in dto.Kpis)
                await _db.ExecuteAsync(@"
                    INSERT INTO plan_kpis (uid, plan_uid, kpi_uid, weight, target_value, slab_set_uid, source_system)
                    VALUES (@i, @p, @k, @w, @t, @s, 'manual')",
                    new { i = Guid.NewGuid().ToString(), p = uid, k = k.KpiUid,
                          w = k.Weight, t = k.TargetValue, s = k.SlabSetUid }, t);
        });
        return Ok(new { success = true });
    }

    public class SlabTierInput { public int? TierOrder { get; set; } public double MinPercent { get; set; } public double? MaxPercent { get; set; } public double Rate { get; set; } public string? RateType { get; set; } public bool? MinInclusive { get; set; } public bool? MaxInclusive { get; set; } }
    public class SlabSetInput { public string Name { get; set; } = ""; public string? Type { get; set; } public string? KpiUid { get; set; } public string? RoleUid { get; set; } public List<SlabTierInput> Tiers { get; set; } = new(); }
    public class SlabsDto { public List<SlabSetInput> SlabSets { get; set; } = new(); }

    [HttpPut("{uid}/slabs")]
    public async Task<IActionResult> UpdateSlabs(string uid, [FromBody] SlabsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            // Cascading delete via slab_tiers.slab_set_uid FK ON DELETE CASCADE
            await _db.ExecuteAsync("DELETE FROM slab_sets WHERE plan_uid = @p", new { p = uid }, t);

            foreach (var ss in dto.SlabSets)
            {
                var ssUid = Guid.NewGuid().ToString();
                await _db.ExecuteAsync(@"
                    INSERT INTO slab_sets (uid, name, type, plan_uid, kpi_uid, role_uid, source_system)
                    VALUES (@i, @n, @t, @p, @k, @r, 'manual')",
                    new { i = ssUid, n = ss.Name, t = ss.Type ?? "step", p = uid, k = ss.KpiUid, r = ss.RoleUid }, t);
                int order = 1;
                foreach (var tier in ss.Tiers)
                {
                    await _db.ExecuteAsync(@"
                        INSERT INTO slab_tiers
                            (uid, slab_set_uid, tier_order, min_percent, max_percent,
                             rate, rate_type, min_inclusive, max_inclusive, source_system)
                        VALUES (@i, @s, @o, @mn, @mx, @r, @rt, @minInc, @maxInc, 'manual')",
                        new {
                            i = Guid.NewGuid().ToString(), s = ssUid, o = tier.TierOrder ?? order,
                            mn = tier.MinPercent, mx = tier.MaxPercent, r = tier.Rate,
                            rt = tier.RateType ?? "percentage",
                            minInc = tier.MinInclusive ?? true, maxInc = tier.MaxInclusive ?? false
                        }, t);
                    order++;
                }
            }
        });
        return Ok(new { success = true });
    }

    public class RuleInput { public string Dimension { get; set; } = ""; public string RuleType { get; set; } = ""; public string? MatchType { get; set; } public List<object>? MatchValues { get; set; } public int? Priority { get; set; } }
    public class RuleSetInput { public string Name { get; set; } = ""; public string? Description { get; set; } public List<RuleInput> Rules { get; set; } = new(); }
    public class RulesDto { public List<RuleSetInput> RuleSets { get; set; } = new(); }

    [HttpPut("{uid}/rules")]
    public async Task<IActionResult> UpdateRules(string uid, [FromBody] RulesDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            // Cascading delete via rules.rule_set_uid FK ON DELETE CASCADE
            await _db.ExecuteAsync("DELETE FROM rule_sets WHERE plan_uid = @p", new { p = uid }, t);

            foreach (var rs in dto.RuleSets)
            {
                var rsUid = Guid.NewGuid().ToString();
                await _db.ExecuteAsync(
                    "INSERT INTO rule_sets (uid, plan_uid, name, description, source_system) VALUES (@i, @p, @n, @d, 'manual')",
                    new { i = rsUid, p = uid, n = rs.Name, d = rs.Description }, t);
                int order = 0;
                foreach (var r in rs.Rules)
                {
                    await _db.ExecuteAsync(@"
                        INSERT INTO rules
                            (uid, rule_set_uid, dimension, rule_type, match_type, match_values, priority, source_system)
                        VALUES (@i, @s, @d, @rt, @mt, @mv::jsonb, @pr, 'manual')",
                        new {
                            i = Guid.NewGuid().ToString(), s = rsUid, d = r.Dimension, rt = r.RuleType,
                            mt = r.MatchType ?? "exact",
                            mv = JsonSerializer.Serialize(r.MatchValues ?? new()),
                            pr = r.Priority ?? order
                        }, t);
                    order++;
                }
            }
        });
        return Ok(new { success = true });
    }

    public class EligRuleInput { public string Metric { get; set; } = ""; public string? Operator { get; set; } public double Threshold { get; set; } public string? Action { get; set; } public double? ReductionPercent { get; set; } }
    public class EligDto { public List<EligRuleInput> Rules { get; set; } = new(); }

    [HttpPut("{uid}/eligibility")]
    public async Task<IActionResult> UpdateEligibility(string uid, [FromBody] EligDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM eligibility_rules WHERE plan_uid = @p", new { p = uid }, t);
            foreach (var r in dto.Rules)
                await _db.ExecuteAsync(@"
                    INSERT INTO eligibility_rules
                        (uid, plan_uid, metric, operator, threshold, action, reduction_percent, source_system)
                    VALUES (@i, @p, @m, @op, @t, @a, @r, 'manual')",
                    new {
                        i = Guid.NewGuid().ToString(), p = uid, m = r.Metric, op = r.Operator ?? ">=",
                        t = r.Threshold, a = r.Action ?? "zero_payout", r = r.ReductionPercent ?? 0
                    }, t);
        });
        return Ok(new { success = true });
    }

    public class MultRuleInput { public string Name { get; set; } = ""; public string Type { get; set; } = ""; public string ConditionMetric { get; set; } = ""; public string? ConditionOperator { get; set; } public double ConditionValue { get; set; } public double? MultiplierValue { get; set; } public string? StackingMode { get; set; } }
    public class MultDto { public List<MultRuleInput> Rules { get; set; } = new(); }

    [HttpPut("{uid}/multipliers")]
    public async Task<IActionResult> UpdateMultipliers(string uid, [FromBody] MultDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM multiplier_rules WHERE plan_uid = @p", new { p = uid }, t);
            foreach (var r in dto.Rules)
                await _db.ExecuteAsync(@"
                    INSERT INTO multiplier_rules
                        (uid, plan_uid, name, type, condition_metric, condition_operator, condition_value,
                         multiplier_value, stacking_mode, source_system)
                    VALUES (@i, @p, @n, @ty, @cm, @co, @cv, @mv, @sm, 'manual')",
                    new {
                        i = Guid.NewGuid().ToString(), p = uid, n = r.Name, ty = r.Type,
                        cm = r.ConditionMetric, co = r.ConditionOperator ?? ">=", cv = r.ConditionValue,
                        mv = r.MultiplierValue ?? 1.0, sm = r.StackingMode ?? "multiplicative"
                    }, t);
        });
        return Ok(new { success = true });
    }

    public class KpiDedInput { public string? KpiUid { get; set; } public string? RoleUid { get; set; } public string? Name { get; set; } public string? MetricType { get; set; } public double? MinValue { get; set; } public double? MaxValue { get; set; } public bool? MinInclusive { get; set; } public bool? MaxInclusive { get; set; } public double DeductionPercent { get; set; } public int? Priority { get; set; } public bool? IsActive { get; set; } }
    public class KpiDedDto { public List<KpiDedInput> Rules { get; set; } = new(); }

    [HttpPut("{uid}/kpi-deductions")]
    public async Task<IActionResult> UpdateKpiDeductions(string uid, [FromBody] KpiDedDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM kpi_deduction_rules WHERE plan_uid = @p", new { p = uid }, t);
            int idx = 0;
            foreach (var r in dto.Rules)
            {
                await _db.ExecuteAsync(@"
                    INSERT INTO kpi_deduction_rules
                        (uid, plan_uid, kpi_uid, role_uid, name, metric_type, min_value, max_value,
                         min_inclusive, max_inclusive, deduction_percent, priority, is_active, source_system)
                    VALUES (@i, @p, @k, @ro, @n, @mt, @mn, @mx, @mi, @ma, @d, @pr, @ia, 'manual')",
                    new {
                        i = Guid.NewGuid().ToString(), p = uid, k = r.KpiUid, ro = r.RoleUid,
                        n = r.Name ?? $"KPI deduction {idx + 1}",
                        mt = r.MetricType ?? "shortfall_percent",
                        mn = r.MinValue, mx = r.MaxValue,
                        mi = r.MinInclusive ?? true, ma = r.MaxInclusive ?? true,
                        d = r.DeductionPercent, pr = r.Priority ?? idx, ia = r.IsActive ?? true
                    }, t);
                idx++;
            }
        });
        return Ok(new { success = true, count = dto.Rules.Count });
    }

    public class MonthlyTargetInput { public string KpiUid { get; set; } = ""; public string? RoleUid { get; set; } public string Period { get; set; } = ""; public double TargetValue { get; set; } }
    public class MonthlyTargetsDto { public List<MonthlyTargetInput> Targets { get; set; } = new(); }

    [HttpPut("{uid}/monthly-targets")]
    public async Task<IActionResult> UpdateMonthlyTargets(string uid, [FromBody] MonthlyTargetsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_kpi_monthly_targets WHERE plan_uid = @p", new { p = uid }, t);
            foreach (var tgt in dto.Targets)
                await _db.ExecuteAsync(@"
                    INSERT INTO plan_kpi_monthly_targets
                        (uid, plan_uid, kpi_uid, role_uid, period, target_value, source_system)
                    VALUES (@i, @p, @k, @r, @per, @v, 'manual')",
                    new {
                        i = Guid.NewGuid().ToString(), p = uid,
                        k = tgt.KpiUid, r = tgt.RoleUid, per = tgt.Period, v = tgt.TargetValue
                    }, t);
        });
        return Ok(new { success = true, count = dto.Targets.Count });
    }

    public class FixedIncInput { public string? RoleUid { get; set; } public string? Period { get; set; } public string Name { get; set; } = ""; public double Amount { get; set; } public string? ConditionKpiUid { get; set; } public string? ConditionOperator { get; set; } public double? ConditionValue { get; set; } public bool? IsActive { get; set; } }
    public class FixedIncDto { public List<FixedIncInput> Incentives { get; set; } = new(); }

    [HttpPut("{uid}/fixed-incentives")]
    public async Task<IActionResult> UpdateFixedIncentives(string uid, [FromBody] FixedIncDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_fixed_incentives WHERE plan_uid = @p", new { p = uid }, t);
            foreach (var i in dto.Incentives)
                await _db.ExecuteAsync(@"
                    INSERT INTO plan_fixed_incentives
                        (uid, plan_uid, role_uid, period, name, amount,
                         condition_kpi_uid, condition_operator, condition_value, is_active, source_system)
                    VALUES (@i, @p, @r, @per, @n, @a, @ck, @co, @cv, @ia, 'manual')",
                    new {
                        i = Guid.NewGuid().ToString(), p = uid,
                        r = i.RoleUid, per = i.Period, n = i.Name, a = i.Amount,
                        ck = i.ConditionKpiUid, co = i.ConditionOperator ?? ">=",
                        cv = i.ConditionValue, ia = i.IsActive ?? true
                    }, t);
        });
        return Ok(new { success = true, count = dto.Incentives.Count });
    }

    public class PenaltyInput { public string Name { get; set; } = ""; public string TriggerMetric { get; set; } = ""; public string? TriggerOperator { get; set; } public double TriggerValue { get; set; } public string? PenaltyType { get; set; } public double PenaltyValue { get; set; } }
    public class PenaltyDto { public List<PenaltyInput> Rules { get; set; } = new(); }

    [HttpPut("{uid}/penalties")]
    public async Task<IActionResult> UpdatePenalties(string uid, [FromBody] PenaltyDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM penalty_rules WHERE plan_uid = @p", new { p = uid }, t);
            foreach (var r in dto.Rules)
                await _db.ExecuteAsync(@"
                    INSERT INTO penalty_rules
                        (uid, plan_uid, name, trigger_metric, trigger_operator, trigger_value,
                         penalty_type, penalty_value, source_system)
                    VALUES (@i, @p, @n, @tm, @to, @tv, @pt, @pv, 'manual')",
                    new {
                        i = Guid.NewGuid().ToString(), p = uid, n = r.Name, tm = r.TriggerMetric,
                        to = r.TriggerOperator ?? ">", tv = r.TriggerValue,
                        pt = r.PenaltyType ?? "percentage", pv = r.PenaltyValue
                    }, t);
        });
        return Ok(new { success = true });
    }

    public class CapInput { public string CapType { get; set; } = ""; public double CapValue { get; set; } }
    public class CapDto { public List<CapInput> Rules { get; set; } = new(); }

    [HttpPut("{uid}/caps")]
    public async Task<IActionResult> UpdateCaps(string uid, [FromBody] CapDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM capping_rules WHERE plan_uid = @p", new { p = uid }, t);
            foreach (var r in dto.Rules)
                await _db.ExecuteAsync(
                    "INSERT INTO capping_rules (uid, plan_uid, cap_type, cap_value, source_system) VALUES (@i, @p, @ct, @cv, 'manual')",
                    new { i = Guid.NewGuid().ToString(), p = uid, ct = r.CapType, cv = r.CapValue }, t);
        });
        return Ok(new { success = true });
    }

    public class SplitParticipantInput { public string RoleUid { get; set; } = ""; public double SplitPercent { get; set; } }
    public class SplitInput { public string Name { get; set; } = ""; public string? TriggerCondition { get; set; } public List<SplitParticipantInput> Participants { get; set; } = new(); }
    public class SplitsDto { public List<SplitInput> Rules { get; set; } = new(); }

    [HttpPut("{uid}/splits")]
    public async Task<IActionResult> UpdateSplits(string uid, [FromBody] SplitsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            // Cascading delete via split_participants.split_rule_uid FK ON DELETE CASCADE
            await _db.ExecuteAsync("DELETE FROM split_rules WHERE plan_uid = @p", new { p = uid }, t);

            foreach (var sr in dto.Rules)
            {
                var srUid = Guid.NewGuid().ToString();
                await _db.ExecuteAsync(
                    "INSERT INTO split_rules (uid, plan_uid, name, trigger_condition, source_system) VALUES (@i, @p, @n, @tc, 'manual')",
                    new { i = srUid, p = uid, n = sr.Name, tc = sr.TriggerCondition }, t);
                foreach (var pt in sr.Participants)
                    await _db.ExecuteAsync(
                        "INSERT INTO split_participants (uid, split_rule_uid, role_uid, split_percent, source_system) VALUES (@i, @s, @r, @sp, 'manual')",
                        new { i = Guid.NewGuid().ToString(), s = srUid, r = pt.RoleUid, sp = pt.SplitPercent }, t);
            }
        });
        return Ok(new { success = true });
    }
}
