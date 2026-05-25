using System.Text.Json;
using Commission.Api.Data;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

/// <summary>
/// Port of server/src/routes/plans.js — plan CRUD + 13 PUT sub-resources
/// for each Plan Builder tab. Each sub-resource is full-replace.
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
                COALESCE((SELECT COUNT(*) FROM plan_kpis WHERE plan_id = cp.id), 0) AS kpi_count,
                COALESCE((SELECT COUNT(*) FROM plan_territories WHERE plan_id = cp.id), 0) AS territory_count
            FROM commission_plans cp
            ORDER BY cp.created_at DESC")).ToList();

        var allRoles = (await _db.QueryDynamicAsync(@"
            SELECT pr.plan_id, r.id, r.name FROM plan_roles pr
            JOIN roles r ON pr.role_id = r.id")).ToList();
        var rolesByPlan = new Dictionary<string, List<object>>();
        foreach (var r in allRoles)
        {
            string pid = r.plan_id;
            if (!rolesByPlan.TryGetValue(pid, out var list)) { list = new(); rolesByPlan[pid] = list; }
            list.Add(new { id = (string)r.id, name = (string)r.name });
        }

        var enriched = plans.Select(p =>
        {
            var dict = (IDictionary<string, object?>)p;
            dict["roles"] = rolesByPlan.TryGetValue((string)p.id, out var rs) ? rs : new List<object>();
            return dict;
        });
        return Ok(enriched);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> Get(string id)
    {
        var plan = await _db.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT * FROM commission_plans WHERE id = @id", new { id });
        if (plan is null) return NotFound(new { error = "Plan not found" });

        var dict = (IDictionary<string, object?>)plan;
        dict["roles"] = await _db.QueryDynamicAsync(
            "SELECT r.* FROM plan_roles pr JOIN roles r ON pr.role_id = r.id WHERE pr.plan_id = @id", new { id });
        dict["territories"] = await _db.QueryDynamicAsync(
            "SELECT t.* FROM plan_territories pt JOIN territories t ON pt.territory_id = t.id WHERE pt.plan_id = @id", new { id });
        dict["employees"] = await _db.QueryDynamicAsync(@"
            SELECT e.id, e.name, e.email, e.role_id, r.name AS role_name,
                   e.territory_id, t.name AS territory_name
            FROM plan_employees pe
            JOIN employees e ON pe.employee_id = e.id
            JOIN roles r ON e.role_id = r.id
            LEFT JOIN territories t ON e.territory_id = t.id
            WHERE pe.plan_id = @id
            ORDER BY e.name", new { id });
        dict["kpis"] = await _db.QueryDynamicAsync(@"
            SELECT pk.*, k.name AS kpi_name, k.code AS kpi_code, k.category AS kpi_category,
                   k.formula, k.unit, k.direction
            FROM plan_kpis pk JOIN kpi_definitions k ON pk.kpi_id = k.id
            WHERE pk.plan_id = @id", new { id });

        var slabSets = (await _db.QueryDynamicAsync(@"
            SELECT ss.*, r.name AS role_name FROM slab_sets ss
            LEFT JOIN roles r ON r.id = ss.role_id WHERE ss.plan_id = @id", new { id })).ToList();
        foreach (var ss in slabSets)
        {
            ((IDictionary<string, object?>)ss)["tiers"] = await _db.QueryDynamicAsync(
                "SELECT * FROM slab_tiers WHERE slab_set_id = @s ORDER BY tier_order", new { s = (string)ss.id });
        }
        dict["slab_sets"] = slabSets;

        var ruleSets = (await _db.QueryDynamicAsync(
            "SELECT * FROM rule_sets WHERE plan_id = @id", new { id })).ToList();
        foreach (var rs in ruleSets)
            ((IDictionary<string, object?>)rs)["rules"] = await _db.QueryDynamicAsync(
                "SELECT * FROM rules WHERE rule_set_id = @r", new { r = (string)rs.id });
        dict["rule_sets"] = ruleSets;

        dict["eligibility_rules"] = await _db.QueryDynamicAsync("SELECT * FROM eligibility_rules WHERE plan_id = @id", new { id });
        dict["multiplier_rules"]  = await _db.QueryDynamicAsync("SELECT * FROM multiplier_rules WHERE plan_id = @id", new { id });
        dict["kpi_deduction_rules"] = await _db.QueryDynamicAsync(@"
            SELECT kdr.*, kd.name AS kpi_name, kd.code AS kpi_code, r.name AS role_name
            FROM kpi_deduction_rules kdr
            LEFT JOIN kpi_definitions kd ON kd.id = kdr.kpi_id
            LEFT JOIN roles r ON r.id = kdr.role_id
            WHERE kdr.plan_id = @id ORDER BY kdr.priority, kdr.created_at", new { id });
        dict["penalty_rules"]  = await _db.QueryDynamicAsync("SELECT * FROM penalty_rules WHERE plan_id = @id", new { id });
        dict["monthly_targets"] = await _db.QueryDynamicAsync(@"
            SELECT t.*, k.name AS kpi_name, k.code AS kpi_code, r.name AS role_name
            FROM plan_kpi_monthly_targets t
            JOIN kpi_definitions k ON k.id = t.kpi_id
            LEFT JOIN roles r ON r.id = t.role_id
            WHERE t.plan_id = @id ORDER BY t.period, t.kpi_id", new { id });
        dict["fixed_incentives"] = await _db.QueryDynamicAsync(@"
            SELECT fi.*, k.name AS condition_kpi_name, r.name AS role_name
            FROM plan_fixed_incentives fi
            LEFT JOIN kpi_definitions k ON k.id = fi.condition_kpi_id
            LEFT JOIN roles r ON r.id = fi.role_id
            WHERE fi.plan_id = @id ORDER BY fi.period, fi.name", new { id });
        dict["capping_rules"] = await _db.QueryDynamicAsync("SELECT * FROM capping_rules WHERE plan_id = @id", new { id });

        var splitRules = (await _db.QueryDynamicAsync(
            "SELECT * FROM split_rules WHERE plan_id = @id", new { id })).ToList();
        foreach (var sr in splitRules)
            ((IDictionary<string, object?>)sr)["participants"] = await _db.QueryDynamicAsync(@"
                SELECT sp.*, r.name AS role_name FROM split_participants sp
                JOIN roles r ON sp.role_id = r.id WHERE sp.split_rule_id = @s", new { s = (string)sr.id });
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
        public string? CreatedBy { get; set; }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreatePlanDto dto)
    {
        var id = Guid.NewGuid().ToString();
        await _db.ExecuteAsync(@"
            INSERT INTO commission_plans (id, name, description, plan_type, effective_from, effective_to, base_payout, created_by)
            VALUES (@id, @name, @desc, @type, @from, @to, @base, @by)",
            new {
                id, name = dto.Name, desc = dto.Description, type = dto.PlanType ?? "monthly",
                from = dto.EffectiveFrom, to = dto.EffectiveTo, @base = dto.BasePayout, by = dto.CreatedBy
            });
        await _db.ExecuteAsync(@"
            INSERT INTO audit_trail (id, entity_type, entity_id, action, changes, performed_by)
            VALUES (@id, 'plan', @eid, 'created', @ch, @by)",
            new {
                id = Guid.NewGuid().ToString(), eid = id,
                ch = JsonSerializer.Serialize(new { name = dto.Name }), by = dto.CreatedBy
            });
        var plan = await _db.QuerySingleOrDefaultAsync<dynamic>("SELECT * FROM commission_plans WHERE id = @id", new { id });
        return StatusCode(201, plan);
    }

    public class UpdatePlanDto : CreatePlanDto { public string? Status { get; set; } public string? UpdatedBy { get; set; } }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(string id, [FromBody] UpdatePlanDto dto)
    {
        var existing = await _db.QuerySingleOrDefaultAsync<dynamic>("SELECT id FROM commission_plans WHERE id = @id", new { id });
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
                updated_at = NOW()
            WHERE id = @id",
            new {
                id, name = dto.Name, desc = dto.Description, status = dto.Status, type = dto.PlanType,
                from = (DateTime?)(dto.EffectiveFrom == default ? null : dto.EffectiveFrom),
                to = (DateTime?)(dto.EffectiveTo == default ? null : dto.EffectiveTo),
                @base = (double?)(dto.BasePayout == 0 ? null : dto.BasePayout)
            });

        await _db.ExecuteAsync(@"
            INSERT INTO audit_trail (id, entity_type, entity_id, action, changes, performed_by)
            VALUES (@id, 'plan', @eid, 'updated', @ch, @by)",
            new {
                id = Guid.NewGuid().ToString(), eid = id,
                ch = JsonSerializer.Serialize(dto), by = dto.UpdatedBy
            });

        var updated = await _db.QuerySingleOrDefaultAsync<dynamic>("SELECT * FROM commission_plans WHERE id = @id", new { id });
        return Ok(updated);
    }

    // ===== Sub-resources (all full-replace) =====

    public class RoleIdsDto { public List<string> RoleIds { get; set; } = new(); }

    [HttpPut("{id}/roles")]
    public async Task<IActionResult> UpdateRoles(string id, [FromBody] RoleIdsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_roles WHERE plan_id = @id", new { id }, t);
            foreach (var roleId in dto.RoleIds)
                await _db.ExecuteAsync(
                    "INSERT INTO plan_roles (id, plan_id, role_id) VALUES (@i, @p, @r)",
                    new { i = Guid.NewGuid().ToString(), p = id, r = roleId }, t);
        });
        return Ok(new { success = true });
    }

    public class TerritoryIdsDto { public List<string> TerritoryIds { get; set; } = new(); }

    [HttpPut("{id}/territories")]
    public async Task<IActionResult> UpdateTerritories(string id, [FromBody] TerritoryIdsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_territories WHERE plan_id = @id", new { id }, t);
            foreach (var terrId in dto.TerritoryIds)
                await _db.ExecuteAsync(
                    "INSERT INTO plan_territories (id, plan_id, territory_id) VALUES (@i, @p, @r)",
                    new { i = Guid.NewGuid().ToString(), p = id, r = terrId }, t);
        });
        return Ok(new { success = true });
    }

    public class EmployeeIdsDto { public List<string> EmployeeIds { get; set; } = new(); }

    /// <summary>
    /// Optional whitelist. Empty list = no employee restriction; the plan
    /// applies to every employee that matches plan_roles + plan_territories.
    /// Non-empty list = narrow further to just these employees.
    /// </summary>
    [HttpPut("{id}/employees")]
    public async Task<IActionResult> UpdateEmployees(string id, [FromBody] EmployeeIdsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_employees WHERE plan_id = @id", new { id }, t);
            foreach (var empId in dto.EmployeeIds)
                await _db.ExecuteAsync(
                    "INSERT INTO plan_employees (id, plan_id, employee_id) VALUES (@i, @p, @e)",
                    new { i = Guid.NewGuid().ToString(), p = id, e = empId }, t);
        });
        return Ok(new { success = true });
    }

    public class PlanKpiInput { public string KpiId { get; set; } = ""; public double Weight { get; set; } public double TargetValue { get; set; } public string? SlabSetId { get; set; } }
    public class PlanKpisDto { public List<PlanKpiInput> Kpis { get; set; } = new(); }

    [HttpPut("{id}/kpis")]
    public async Task<IActionResult> UpdateKpis(string id, [FromBody] PlanKpisDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_kpis WHERE plan_id = @id", new { id }, t);
            foreach (var k in dto.Kpis)
                await _db.ExecuteAsync(@"
                    INSERT INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id)
                    VALUES (@i, @p, @k, @w, @t, @s)",
                    new { i = Guid.NewGuid().ToString(), p = id, k = k.KpiId, w = k.Weight, t = k.TargetValue, s = k.SlabSetId }, t);
        });
        return Ok(new { success = true });
    }

    public class SlabTierInput { public int? TierOrder { get; set; } public double MinPercent { get; set; } public double? MaxPercent { get; set; } public double Rate { get; set; } public string? RateType { get; set; } public int? MinInclusive { get; set; } public int? MaxInclusive { get; set; } }
    public class SlabSetInput { public string Name { get; set; } = ""; public string? Type { get; set; } public string? KpiId { get; set; } public string? RoleId { get; set; } public List<SlabTierInput> Tiers { get; set; } = new(); }
    public class SlabsDto { public List<SlabSetInput> SlabSets { get; set; } = new(); }

    [HttpPut("{id}/slabs")]
    public async Task<IActionResult> UpdateSlabs(string id, [FromBody] SlabsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            var existing = await _db.QueryAsync<string>("SELECT id FROM slab_sets WHERE plan_id = @p", new { p = id }, t);
            foreach (var s in existing) await _db.ExecuteAsync("DELETE FROM slab_tiers WHERE slab_set_id = @s", new { s }, t);
            await _db.ExecuteAsync("DELETE FROM slab_sets WHERE plan_id = @p", new { p = id }, t);

            foreach (var ss in dto.SlabSets)
            {
                var ssId = Guid.NewGuid().ToString();
                await _db.ExecuteAsync(@"
                    INSERT INTO slab_sets (id, name, type, plan_id, kpi_id, role_id)
                    VALUES (@i, @n, @t, @p, @k, @r)",
                    new { i = ssId, n = ss.Name, t = ss.Type ?? "step", p = id, k = ss.KpiId, r = ss.RoleId }, t);
                int order = 1;
                foreach (var tier in ss.Tiers)
                {
                    await _db.ExecuteAsync(@"
                        INSERT INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type, min_inclusive, max_inclusive)
                        VALUES (@i, @s, @o, @mn, @mx, @r, @rt, @minInc, @maxInc)",
                        new {
                            i = Guid.NewGuid().ToString(), s = ssId, o = tier.TierOrder ?? order,
                            mn = tier.MinPercent, mx = tier.MaxPercent, r = tier.Rate,
                            rt = tier.RateType ?? "percentage",
                            minInc = tier.MinInclusive ?? 1, maxInc = tier.MaxInclusive ?? 0
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

    [HttpPut("{id}/rules")]
    public async Task<IActionResult> UpdateRules(string id, [FromBody] RulesDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            var existing = await _db.QueryAsync<string>("SELECT id FROM rule_sets WHERE plan_id = @p", new { p = id }, t);
            foreach (var s in existing) await _db.ExecuteAsync("DELETE FROM rules WHERE rule_set_id = @s", new { s }, t);
            await _db.ExecuteAsync("DELETE FROM rule_sets WHERE plan_id = @p", new { p = id }, t);

            foreach (var rs in dto.RuleSets)
            {
                var rsId = Guid.NewGuid().ToString();
                await _db.ExecuteAsync(
                    "INSERT INTO rule_sets (id, plan_id, name, description) VALUES (@i, @p, @n, @d)",
                    new { i = rsId, p = id, n = rs.Name, d = rs.Description }, t);
                int order = 0;
                foreach (var r in rs.Rules)
                {
                    await _db.ExecuteAsync(@"
                        INSERT INTO rules (id, rule_set_id, dimension, rule_type, match_type, match_values, priority)
                        VALUES (@i, @s, @d, @rt, @mt, @mv, @pr)",
                        new {
                            i = Guid.NewGuid().ToString(), s = rsId, d = r.Dimension, rt = r.RuleType,
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

    [HttpPut("{id}/eligibility")]
    public async Task<IActionResult> UpdateEligibility(string id, [FromBody] EligDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM eligibility_rules WHERE plan_id = @p", new { p = id }, t);
            foreach (var r in dto.Rules)
                await _db.ExecuteAsync(@"
                    INSERT INTO eligibility_rules (id, plan_id, metric, operator, threshold, action, reduction_percent)
                    VALUES (@i, @p, @m, @op, @t, @a, @r)",
                    new {
                        i = Guid.NewGuid().ToString(), p = id, m = r.Metric, op = r.Operator ?? ">=",
                        t = r.Threshold, a = r.Action ?? "zero_payout", r = r.ReductionPercent ?? 0
                    }, t);
        });
        return Ok(new { success = true });
    }

    public class MultRuleInput { public string Name { get; set; } = ""; public string Type { get; set; } = ""; public string ConditionMetric { get; set; } = ""; public string? ConditionOperator { get; set; } public double ConditionValue { get; set; } public double? MultiplierValue { get; set; } public string? StackingMode { get; set; } }
    public class MultDto { public List<MultRuleInput> Rules { get; set; } = new(); }

    [HttpPut("{id}/multipliers")]
    public async Task<IActionResult> UpdateMultipliers(string id, [FromBody] MultDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM multiplier_rules WHERE plan_id = @p", new { p = id }, t);
            foreach (var r in dto.Rules)
                await _db.ExecuteAsync(@"
                    INSERT INTO multiplier_rules (id, plan_id, name, type, condition_metric, condition_operator, condition_value, multiplier_value, stacking_mode)
                    VALUES (@i, @p, @n, @ty, @cm, @co, @cv, @mv, @sm)",
                    new {
                        i = Guid.NewGuid().ToString(), p = id, n = r.Name, ty = r.Type,
                        cm = r.ConditionMetric, co = r.ConditionOperator ?? ">=", cv = r.ConditionValue,
                        mv = r.MultiplierValue ?? 1.0, sm = r.StackingMode ?? "multiplicative"
                    }, t);
        });
        return Ok(new { success = true });
    }

    public class KpiDedInput { public string? KpiId { get; set; } public string? RoleId { get; set; } public string? Name { get; set; } public string? MetricType { get; set; } public double? MinValue { get; set; } public double? MaxValue { get; set; } public int? MinInclusive { get; set; } public int? MaxInclusive { get; set; } public double DeductionPercent { get; set; } public int? Priority { get; set; } public int? IsActive { get; set; } }
    public class KpiDedDto { public List<KpiDedInput> Rules { get; set; } = new(); }

    [HttpPut("{id}/kpi-deductions")]
    public async Task<IActionResult> UpdateKpiDeductions(string id, [FromBody] KpiDedDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM kpi_deduction_rules WHERE plan_id = @p", new { p = id }, t);
            int idx = 0;
            foreach (var r in dto.Rules)
            {
                await _db.ExecuteAsync(@"
                    INSERT INTO kpi_deduction_rules
                        (id, plan_id, kpi_id, role_id, name, metric_type, min_value, max_value,
                         min_inclusive, max_inclusive, deduction_percent, priority, is_active)
                    VALUES (@i, @p, @k, @ro, @n, @mt, @mn, @mx, @mi, @ma, @d, @pr, @ia)",
                    new {
                        i = Guid.NewGuid().ToString(), p = id, k = r.KpiId, ro = r.RoleId,
                        n = r.Name ?? $"KPI deduction {idx + 1}",
                        mt = r.MetricType ?? "shortfall_percent",
                        mn = r.MinValue, mx = r.MaxValue,
                        mi = r.MinInclusive ?? 1, ma = r.MaxInclusive ?? 1,
                        d = r.DeductionPercent, pr = r.Priority ?? idx, ia = r.IsActive ?? 1
                    }, t);
                idx++;
            }
        });
        return Ok(new { success = true, count = dto.Rules.Count });
    }

    public class MonthlyTargetInput { public string KpiId { get; set; } = ""; public string? RoleId { get; set; } public string Period { get; set; } = ""; public double TargetValue { get; set; } }
    public class MonthlyTargetsDto { public List<MonthlyTargetInput> Targets { get; set; } = new(); }

    [HttpPut("{id}/monthly-targets")]
    public async Task<IActionResult> UpdateMonthlyTargets(string id, [FromBody] MonthlyTargetsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_kpi_monthly_targets WHERE plan_id = @p", new { p = id }, t);
            foreach (var tgt in dto.Targets)
                await _db.ExecuteAsync(@"
                    INSERT INTO plan_kpi_monthly_targets (id, plan_id, kpi_id, role_id, period, target_value)
                    VALUES (@i, @p, @k, @r, @per, @v)",
                    new { i = Guid.NewGuid().ToString(), p = id, k = tgt.KpiId, r = tgt.RoleId, per = tgt.Period, v = tgt.TargetValue }, t);
        });
        return Ok(new { success = true, count = dto.Targets.Count });
    }

    public class FixedIncInput { public string? RoleId { get; set; } public string? Period { get; set; } public string Name { get; set; } = ""; public double Amount { get; set; } public string? ConditionKpiId { get; set; } public string? ConditionOperator { get; set; } public double? ConditionValue { get; set; } public int? IsActive { get; set; } }
    public class FixedIncDto { public List<FixedIncInput> Incentives { get; set; } = new(); }

    [HttpPut("{id}/fixed-incentives")]
    public async Task<IActionResult> UpdateFixedIncentives(string id, [FromBody] FixedIncDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM plan_fixed_incentives WHERE plan_id = @p", new { p = id }, t);
            foreach (var i in dto.Incentives)
                await _db.ExecuteAsync(@"
                    INSERT INTO plan_fixed_incentives
                        (id, plan_id, role_id, period, name, amount, condition_kpi_id, condition_operator, condition_value, is_active)
                    VALUES (@i, @p, @r, @per, @n, @a, @ck, @co, @cv, @ia)",
                    new {
                        i = Guid.NewGuid().ToString(), p = id, r = i.RoleId, per = i.Period, n = i.Name,
                        a = i.Amount, ck = i.ConditionKpiId, co = i.ConditionOperator ?? ">=",
                        cv = i.ConditionValue, ia = i.IsActive ?? 1
                    }, t);
        });
        return Ok(new { success = true, count = dto.Incentives.Count });
    }

    public class PenaltyInput { public string Name { get; set; } = ""; public string TriggerMetric { get; set; } = ""; public string? TriggerOperator { get; set; } public double TriggerValue { get; set; } public string? PenaltyType { get; set; } public double PenaltyValue { get; set; } }
    public class PenaltyDto { public List<PenaltyInput> Rules { get; set; } = new(); }

    [HttpPut("{id}/penalties")]
    public async Task<IActionResult> UpdatePenalties(string id, [FromBody] PenaltyDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM penalty_rules WHERE plan_id = @p", new { p = id }, t);
            foreach (var r in dto.Rules)
                await _db.ExecuteAsync(@"
                    INSERT INTO penalty_rules (id, plan_id, name, trigger_metric, trigger_operator, trigger_value, penalty_type, penalty_value)
                    VALUES (@i, @p, @n, @tm, @to, @tv, @pt, @pv)",
                    new {
                        i = Guid.NewGuid().ToString(), p = id, n = r.Name, tm = r.TriggerMetric,
                        to = r.TriggerOperator ?? ">", tv = r.TriggerValue,
                        pt = r.PenaltyType ?? "percentage", pv = r.PenaltyValue
                    }, t);
        });
        return Ok(new { success = true });
    }

    public class CapInput { public string CapType { get; set; } = ""; public double CapValue { get; set; } }
    public class CapDto { public List<CapInput> Rules { get; set; } = new(); }

    [HttpPut("{id}/caps")]
    public async Task<IActionResult> UpdateCaps(string id, [FromBody] CapDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            await _db.ExecuteAsync("DELETE FROM capping_rules WHERE plan_id = @p", new { p = id }, t);
            foreach (var r in dto.Rules)
                await _db.ExecuteAsync(
                    "INSERT INTO capping_rules (id, plan_id, cap_type, cap_value) VALUES (@i, @p, @ct, @cv)",
                    new { i = Guid.NewGuid().ToString(), p = id, ct = r.CapType, cv = r.CapValue }, t);
        });
        return Ok(new { success = true });
    }

    public class SplitParticipantInput { public string RoleId { get; set; } = ""; public double SplitPercent { get; set; } }
    public class SplitInput { public string Name { get; set; } = ""; public string? TriggerCondition { get; set; } public List<SplitParticipantInput> Participants { get; set; } = new(); }
    public class SplitsDto { public List<SplitInput> Rules { get; set; } = new(); }

    [HttpPut("{id}/splits")]
    public async Task<IActionResult> UpdateSplits(string id, [FromBody] SplitsDto dto)
    {
        await _db.InTransactionAsync(async (c, t) =>
        {
            var existing = await _db.QueryAsync<string>("SELECT id FROM split_rules WHERE plan_id = @p", new { p = id }, t);
            foreach (var s in existing) await _db.ExecuteAsync("DELETE FROM split_participants WHERE split_rule_id = @s", new { s }, t);
            await _db.ExecuteAsync("DELETE FROM split_rules WHERE plan_id = @p", new { p = id }, t);

            foreach (var sr in dto.Rules)
            {
                var srId = Guid.NewGuid().ToString();
                await _db.ExecuteAsync(
                    "INSERT INTO split_rules (id, plan_id, name, trigger_condition) VALUES (@i, @p, @n, @tc)",
                    new { i = srId, p = id, n = sr.Name, tc = sr.TriggerCondition }, t);
                foreach (var pt in sr.Participants)
                    await _db.ExecuteAsync(
                        "INSERT INTO split_participants (id, split_rule_id, role_id, split_percent) VALUES (@i, @s, @r, @sp)",
                        new { i = Guid.NewGuid().ToString(), s = srId, r = pt.RoleId, sp = pt.SplitPercent }, t);
            }
        });
        return Ok(new { success = true });
    }
}
