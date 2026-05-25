using System.Text.Json;
using Commission.Api.Data;
using Dapper;

namespace Commission.Api.Engine;

/// <summary>
/// Port of server/src/engine/calculationPipeline.js — the orchestrator.
/// 13-step loop per employee. Faithful 1:1 to the JS version.
/// </summary>
public class CalculationPipeline
{
    private readonly IDb _db;
    private readonly FormulaEvaluator _formula;
    private readonly EligibilityEngine _eligibility;
    private readonly MappingFilters _filters;

    public CalculationPipeline(IDb db, FormulaEvaluator formula, EligibilityEngine eligibility, MappingFilters filters)
    {
        _db = db;
        _formula = formula;
        _eligibility = eligibility;
        _filters = filters;
    }

    public async Task<PipelineRunResult> RunAsync(PipelineRunRequest req, CancellationToken ct = default)
    {
        var startTime = DateTime.UtcNow;
        var stepsLog = new List<Dictionary<string, object?>>();
        void Log(double step, string name, object? detail) =>
            stepsLog.Add(new() {
                ["step"] = step, ["name"] = name, ["detail"] = detail,
                ["timestamp"] = (DateTime.UtcNow - startTime).TotalMilliseconds
            });

        // 1. Load plan
        var plan = await _db.QuerySingleOrDefaultAsync<PlanRow>(@"
            SELECT id, name, description, status, plan_type AS PlanType,
                   effective_from AS EffectiveFrom, effective_to AS EffectiveTo,
                   base_payout AS BasePayout, currency, created_by AS CreatedBy
            FROM commission_plans WHERE id = @id",
            new { id = req.PlanId }, ct: ct)
            ?? throw new InvalidOperationException("Plan not found");

        // 2. Create run row
        var runId = Guid.NewGuid().ToString();
        await _db.ExecuteAsync(@"
            INSERT INTO calculation_runs (id, plan_id, period, status, is_simulation, simulation_params, created_by)
            VALUES (@id, @plan, @period, 'running', @sim, @params::text, @by)",
            new {
                id = runId, plan = req.PlanId, period = req.Period,
                sim = req.IsSimulation ? 1 : 0,
                @params = JsonSerializer.Serialize(req.Overrides ?? new()),
                by = req.CreatedBy
            }, ct: ct);

        try
        {
            // 3. Eligible employees: roles + territories (with hierarchy expansion)
            var planRoles = (await _db.QueryAsync<string>(
                "SELECT role_id FROM plan_roles WHERE plan_id = @p", new { p = req.PlanId }, ct: ct)).ToList();
            var planTerritories = (await _db.QueryAsync<string>(
                "SELECT territory_id FROM plan_territories WHERE plan_id = @p", new { p = req.PlanId }, ct: ct)).ToList();

            List<Employee> employees;
            if (planRoles.Count > 0)
            {
                employees = (await _db.QueryAsync<Employee>(@"
                    SELECT e.id, e.name, e.email, e.external_id AS ExternalId,
                           e.role_id AS RoleId, e.territory_id AS TerritoryId,
                           e.reports_to AS ReportsTo, e.base_salary AS BaseSalary,
                           e.hire_date AS HireDate, e.is_active AS IsActive,
                           r.name AS RoleName
                    FROM employees e JOIN roles r ON e.role_id = r.id
                    WHERE e.is_active = 1 AND e.role_id = ANY(@roles)",
                    new { roles = planRoles.ToArray() }, ct: ct)).ToList();
            }
            else employees = new();

            List<Employee> filteredEmps;
            if (planTerritories.Count > 0)
            {
                var allTerrs = (await _db.QueryDynamicAsync(
                    "SELECT id, parent_id FROM territories", ct: ct)).ToList();
                var allowed = new HashSet<string>(planTerritories);
                bool changed = true;
                while (changed)
                {
                    changed = false;
                    foreach (var t in allTerrs)
                    {
                        string id = t.id; string? pid = t.parent_id;
                        if (!allowed.Contains(id) && pid != null && allowed.Contains(pid))
                        { allowed.Add(id); changed = true; }
                    }
                }
                filteredEmps = employees.Where(e => e.TerritoryId != null && allowed.Contains(e.TerritoryId)).ToList();
            }
            else filteredEmps = employees;

            // Optional whitelist: if plan has explicit employees configured,
            // narrow further. Empty = no restriction (current behavior).
            var planEmployees = (await _db.QueryAsync<string>(
                "SELECT employee_id FROM plan_employees WHERE plan_id = @p", new { p = req.PlanId }, ct: ct)).ToList();
            if (planEmployees.Count > 0)
            {
                var allowedEmps = new HashSet<string>(planEmployees);
                filteredEmps = filteredEmps.Where(e => allowedEmps.Contains(e.Id)).ToList();
            }

            if (filteredEmps.Count == 0)
            {
                Log(0, "No Eligible Employees", new {
                    planRoles = planRoles.Count,
                    planTerritories = planTerritories.Count,
                    totalEmployees = employees.Count,
                });
                await _db.ExecuteAsync(
                    "UPDATE calculation_runs SET status = 'completed', total_payout = 0 WHERE id = @id",
                    new { id = runId }, ct: ct);
                return new PipelineRunResult
                {
                    RunId = runId, PlanId = req.PlanId, Period = req.Period, Status = "completed",
                    IsSimulation = req.IsSimulation, Steps = stepsLog,
                    Message = "No eligible employees found for this plan configuration"
                };
            }

            if (!string.IsNullOrEmpty(req.EmployeeId))
                filteredEmps = filteredEmps.Where(e => e.Id == req.EmployeeId).ToList();

            Log(0, "Initialize", new { employee_count = filteredEmps.Count, plan = plan.Name });

            // 4. Load plan KPIs + slabs + rules + modifiers (one-shot, JS uses N+1 here)
            var planKpis = (await _db.QueryAsync<PlanKpi>(@"
                SELECT pk.id, pk.plan_id AS PlanId, pk.kpi_id AS KpiId,
                       pk.weight, pk.target_value AS TargetValue, pk.slab_set_id AS SlabSetId,
                       k.name AS KpiName, k.code AS KpiCode, k.formula,
                       k.unit, k.direction, k.category AS KpiCategory
                FROM plan_kpis pk JOIN kpi_definitions k ON pk.kpi_id = k.id
                WHERE pk.plan_id = @p", new { p = req.PlanId }, ct: ct)).ToList();

            var ruleSets = (await _db.QueryAsync<RuleSet>(@"
                SELECT id, plan_id AS PlanId, name, description
                FROM rule_sets WHERE plan_id = @p", new { p = req.PlanId }, ct: ct)).ToList();
            foreach (var rs in ruleSets)
            {
                rs.Rules = (await _db.QueryAsync<Rule>(@"
                    SELECT id, rule_set_id AS RuleSetId, parent_rule_id AS ParentRuleId,
                           dimension, rule_type AS RuleType, match_type AS MatchType,
                           match_values AS MatchValues, priority,
                           valid_from AS ValidFrom, valid_to AS ValidTo,
                           conditional_logic AS ConditionalLogic
                    FROM rules WHERE rule_set_id = @id", new { id = rs.Id }, ct: ct)).ToList();
            }

            TagContext? tagCtx = null;
            try { tagCtx = await _filters.BuildTagContextAsync(ct); }
            catch { tagCtx = new(); }

            var asOf = req.Period.Contains('-')
                ? DateTime.Parse($"{req.Period[..7]}-28")
                : DateTime.UtcNow.Date;

            var eligibilityRules = (await _db.QueryAsync<EligibilityRule>(@"
                SELECT id, plan_id AS PlanId, metric, operator, threshold, action,
                       reduction_percent AS ReductionPercent, is_active AS IsActive
                FROM eligibility_rules WHERE plan_id = @p AND is_active = 1",
                new { p = req.PlanId }, ct: ct)).ToList();

            var multiplierRules = (await _db.QueryAsync<MultiplierRule>(@"
                SELECT id, plan_id AS PlanId, name, type, condition_metric AS ConditionMetric,
                       condition_operator AS ConditionOperator, condition_value AS ConditionValue,
                       multiplier_value AS MultiplierValue, stacking_mode AS StackingMode, is_active AS IsActive
                FROM multiplier_rules WHERE plan_id = @p AND is_active = 1",
                new { p = req.PlanId }, ct: ct)).ToList();

            var kpiDeductionRules = (await _db.QueryAsync<KpiDeductionRule>(@"
                SELECT id, plan_id AS PlanId, kpi_id AS KpiId, role_id AS RoleId, name,
                       metric_type AS MetricType, min_value AS MinValue, max_value AS MaxValue,
                       min_inclusive AS MinInclusive, max_inclusive AS MaxInclusive,
                       deduction_percent AS DeductionPercent, priority, is_active AS IsActive
                FROM kpi_deduction_rules WHERE plan_id = @p AND is_active = 1",
                new { p = req.PlanId }, ct: ct)).ToList();

            var penaltyRules = (await _db.QueryAsync<PenaltyRule>(@"
                SELECT id, plan_id AS PlanId, name, trigger_metric AS TriggerMetric,
                       trigger_operator AS TriggerOperator, trigger_value AS TriggerValue,
                       penalty_type AS PenaltyType, penalty_value AS PenaltyValue, is_active AS IsActive
                FROM penalty_rules WHERE plan_id = @p AND is_active = 1",
                new { p = req.PlanId }, ct: ct)).ToList();

            var cappingRules = (await _db.QueryAsync<CappingRule>(@"
                SELECT id, plan_id AS PlanId, cap_type AS CapType, cap_value AS CapValue, is_active AS IsActive
                FROM capping_rules WHERE plan_id = @p AND is_active = 1",
                new { p = req.PlanId }, ct: ct)).ToList();

            var monthlyTargets = (await _db.QueryAsync<MonthlyTarget>(@"
                SELECT id, plan_id AS PlanId, kpi_id AS KpiId, role_id AS RoleId,
                       period, target_value AS TargetValue
                FROM plan_kpi_monthly_targets WHERE plan_id = @p AND period = @period",
                new { p = req.PlanId, period = req.Period }, ct: ct)).ToList();

            var fixedIncentives = (await _db.QueryAsync<FixedIncentiveRule>(@"
                SELECT id, plan_id AS PlanId, role_id AS RoleId, period, name, amount,
                       condition_kpi_id AS ConditionKpiId, condition_operator AS ConditionOperator,
                       condition_value AS ConditionValue, is_active AS IsActive
                FROM plan_fixed_incentives
                WHERE plan_id = @p AND is_active = 1 AND (period IS NULL OR period = @period)",
                new { p = req.PlanId, period = req.Period }, ct: ct)).ToList();

            var splitRules = (await _db.QueryAsync<SplitRule>(@"
                SELECT id, plan_id AS PlanId, name, trigger_condition AS TriggerCondition, is_active AS IsActive
                FROM split_rules WHERE plan_id = @p AND is_active = 1",
                new { p = req.PlanId }, ct: ct)).ToList();
            foreach (var sr in splitRules)
            {
                sr.Participants = (await _db.QueryAsync<SplitParticipant>(@"
                    SELECT id, split_rule_id AS SplitRuleId, role_id AS RoleId, split_percent AS SplitPercent
                    FROM split_participants WHERE split_rule_id = @id", new { id = sr.Id }, ct: ct)).ToList();
            }

            // Slab sets keyed by kpi_id
            var slabSets = new Dictionary<string, List<SlabSet>>();
            foreach (var pk in planKpis)
            {
                var sets = (await _db.QueryAsync<SlabSet>(@"
                    SELECT id, name, type, plan_id AS PlanId, kpi_id AS KpiId, role_id AS RoleId
                    FROM slab_sets WHERE plan_id = @p AND kpi_id = @k",
                    new { p = plan.Id, k = pk.KpiId }, ct: ct)).ToList();
                foreach (var ss in sets)
                {
                    ss.Tiers = (await _db.QueryAsync<SlabTier>(@"
                        SELECT id, slab_set_id AS SlabSetId, tier_order AS TierOrder,
                               min_percent AS MinPercent, max_percent AS MaxPercent,
                               rate, rate_type AS RateType,
                               min_inclusive AS MinInclusive, max_inclusive AS MaxInclusive
                        FROM slab_tiers WHERE slab_set_id = @s ORDER BY tier_order",
                        new { s = ss.Id }, ct: ct)).ToList();
                }
                slabSets[pk.KpiId] = sets;
            }

            // Overrides (from request)
            double basePayoutOverride = 0;
            if (req.Overrides != null && req.Overrides.TryGetValue("base_payout", out var bp) && bp != null)
                double.TryParse(bp.ToString(), out basePayoutOverride);

            var allPayouts = new List<Dictionary<string, object?>>();

            // ===== Per-employee loop =====
            foreach (var employee in filteredEmps)
            {
                var basePayout = basePayoutOverride > 0 ? basePayoutOverride : plan.BasePayout;

                // Step 1
                var transactions = await Steps.FetchScopedTransactionsAsync(
                    _db, employee.Id, req.Period, employee.TerritoryId, employee.RoleId, ct);
                Log(1, "Fetch Transactions", new { employee = employee.Name, count = transactions.Count });

                // Resolve tag ids per transaction (needed for tag-based filters)
                foreach (var t in transactions)
                {
                    var pt = (t.ProductId != null && tagCtx!.ProductTags.TryGetValue(t.ProductId, out var p)) ? p : new();
                    var ctags = (t.CustomerId != null && tagCtx.CustomerTags.TryGetValue(t.CustomerId, out var c)) ? c : new();
                    var tt = (t.TerritoryId != null && tagCtx.TerritoryTags.TryGetValue(t.TerritoryId, out var z)) ? z : new();
                    t.TagIds = pt.Concat(ctags).Concat(tt).Distinct().ToList();
                }

                // Step 2
                var filtered = _filters.Apply(transactions, ruleSets, tagCtx, asOf);
                Log(2, "Apply Mapping Filters", new {
                    employee = employee.Name,
                    before = transactions.Count,
                    after = filtered.Count,
                    excluded = transactions.Count - filtered.Count,
                });

                // Step 2.5 — Eligibility
                var eligibility = _eligibility.Check(filtered, eligibilityRules);
                Log(2.5, "Eligibility Check", new {
                    employee = employee.Name, status = eligibility.Status, details = eligibility.Details
                });

                // Steps 3..6 — per KPI
                var kpiResults = new List<KpiResultRow>();
                foreach (var pk in planKpis)
                {
                    var monthlyOverride = monthlyTargets.FirstOrDefault(t =>
                        t.KpiId == pk.KpiId && (string.IsNullOrEmpty(t.RoleId) || t.RoleId == employee.RoleId));
                    double? targetOverride = null;
                    if (req.Overrides != null && req.Overrides.TryGetValue("targets", out var tobj) && tobj is JsonElement tEl
                        && tEl.ValueKind == JsonValueKind.Object && tEl.TryGetProperty(pk.KpiId, out var override1))
                    {
                        if (override1.TryGetDouble(out var d)) targetOverride = d;
                    }
                    if (targetOverride is null && monthlyOverride != null) targetOverride = monthlyOverride.TargetValue;

                    var ach = await Steps.CalculateKpiAchievementAsync(
                        _formula, _db, filtered, pk, employee, req.Period, targetOverride, ct);
                    Log(3, "KPI Achievement", new {
                        employee = employee.Name, kpi = pk.KpiName,
                        actual = ach.Actual, target = ach.Target, percent = ach.Percent
                    });

                    var slabCandidates = slabSets.TryGetValue(pk.KpiId, out var ss) ? ss : new();
                    SlabSet? chosen = null;
                    if (!string.IsNullOrEmpty(pk.SlabSetId))
                        chosen = slabCandidates.FirstOrDefault(s => s.Id == pk.SlabSetId);
                    if (chosen is null)
                        chosen = slabCandidates.FirstOrDefault(s => s.RoleId == employee.RoleId)
                              ?? slabCandidates.FirstOrDefault(s => string.IsNullOrEmpty(s.RoleId));

                    var slab = Steps.DetermineSlab(ach.Percent, chosen);
                    Log(4, "Determine Slab", new {
                        employee = employee.Name, kpi = pk.KpiName, slab_type = slab.Type, rate = slab.Rate
                    });

                    var rawPayout = Steps.CalculateKpiPayout(ach, slab, basePayout);
                    Log(5, "KPI Payout", new { employee = employee.Name, kpi = pk.KpiName, raw_payout = rawPayout.Amount });

                    var weighted = Steps.ApplyWeight(rawPayout.Amount, pk.Weight);
                    Log(6, "Apply Weight", new { employee = employee.Name, kpi = pk.KpiName, weight = pk.Weight, weighted_payout = weighted });

                    kpiResults.Add(new KpiResultRow
                    {
                        KpiId = pk.KpiId, KpiName = pk.KpiName, KpiCode = pk.KpiCode,
                        KpiCategory = pk.KpiCategory, Unit = pk.Unit,
                        TargetValue = ach.Target, ActualValue = ach.Actual, AchievementPercent = ach.Percent,
                        SlabRate = slab.Rate, SlabType = slab.Type,
                        RawPayout = rawPayout.Amount, WeightedPayout = weighted, Weight = pk.Weight,
                        CalculationDetails = JsonSerializer.Serialize(new {
                            achievement = ach, slab, payout = rawPayout
                        }, Json.Options),
                    });
                }

                // Step 7 — aggregate + helper-trip bonus (§6.3)
                var grossPayout = Steps.AggregateKpis(kpiResults);
                double helperTripAmount = 0;
                Dictionary<string, object?>? helperTripDetails = null;
                try
                {
                    var tiers = (await _db.QueryDynamicAsync(
                        "SELECT team_size, rate_per_person FROM helper_trip_rates WHERE plan_id = @p",
                        new { p = req.PlanId }, ct: ct)).ToList();
                    if (tiers.Count == 0)
                        tiers = (await _db.QueryDynamicAsync(
                            "SELECT team_size, rate_per_person FROM helper_trip_rates WHERE plan_id IS NULL", ct: ct)).ToList();

                    if (tiers.Count > 0)
                    {
                        tiers = tiers.OrderBy(t => (int)t.team_size).ToList();
                        double GetRate(int size)
                        {
                            double rate = 0;
                            foreach (var t in tiers) if ((int)t.team_size <= size) rate = Convert.ToDouble(t.rate_per_person);
                            return rate;
                        }

                        var empTrips = (await _db.QueryDynamicAsync(@"
                            SELECT t.id, t.trip_number, t.trip_date, t.trip_end_date, t.days_count,
                                   (SELECT COUNT(*) FROM trip_participants tp2 WHERE tp2.trip_id = t.id) AS team_size
                            FROM trips t JOIN trip_participants tp ON tp.trip_id = t.id
                            WHERE tp.employee_id = @e AND t.period = @p AND t.status = 'completed'",
                            new { e = employee.Id, p = req.Period }, ct: ct)).ToList();

                        int DaysOf(dynamic t)
                        {
                            int dc = t.days_count is null ? 0 : (int)t.days_count;
                            if (dc > 0) return dc;
                            if (t.trip_end_date is null || (DateTime)t.trip_end_date == (DateTime)t.trip_date) return 1;
                            var diff = (int)((DateTime)t.trip_end_date - (DateTime)t.trip_date).TotalDays + 1;
                            return Math.Max(1, diff);
                        }

                        foreach (var t in empTrips)
                            helperTripAmount += GetRate((int)t.team_size) * DaysOf(t);

                        var totalDays = empTrips.Sum(t => (int)DaysOf(t));
                        helperTripDetails = new() {
                            ["trip_count"] = empTrips.Count,
                            ["total_days"] = totalDays,
                            ["solo"]   = empTrips.Count(t => (int)t.team_size == 1),
                            ["paired"] = empTrips.Count(t => (int)t.team_size == 2),
                            ["team"]   = empTrips.Count(t => (int)t.team_size >= 3),
                            ["total"]  = helperTripAmount,
                        };
                        grossPayout += helperTripAmount;
                    }
                }
                catch { /* trips table may not exist */ }

                Log(7, "Aggregate KPIs", new {
                    employee = employee.Name, gross_payout = grossPayout,
                    helper_trip_bonus = helperTripAmount, trips = helperTripDetails
                });

                // Step 8a — KPI deductions
                var kpiDed = Steps.ApplyKpiDeductions(grossPayout, kpiResults, kpiDeductionRules, employee);
                var payoutAfterDed = grossPayout - kpiDed.Amount;
                Log(8.5, "Apply KPI Deductions", new {
                    employee = employee.Name,
                    deduction_amount = kpiDed.Amount,
                    deduction_percent = kpiDed.TotalPercent,
                    triggered = kpiDed.Triggered
                });

                // Step 8 — multipliers
                Dictionary<string, double>? multOverrides = null;
                if (req.Overrides != null && req.Overrides.TryGetValue("multipliers", out var mo) && mo is JsonElement moEl
                    && moEl.ValueKind == JsonValueKind.Object)
                {
                    multOverrides = new();
                    foreach (var prop in moEl.EnumerateObject())
                        if (prop.Value.TryGetDouble(out var d)) multOverrides[prop.Name] = d;
                }
                var mult = await Steps.ApplyMultiplierAsync(_db, payoutAfterDed, multiplierRules, filtered, employee, req.Period, multOverrides, ct);
                Log(8, "Apply Multiplier", new { employee = employee.Name, multiplier_amount = mult.Amount, applied = mult.Applied });

                // Step 9 — penalty
                var pen = Steps.ApplyPenalty(payoutAfterDed + mult.Amount, penaltyRules, filtered);
                Log(9, "Apply Penalty", new { employee = employee.Name, penalty_amount = pen.Amount, triggered = pen.Triggered });

                // Step 9.5 — fixed incentives
                double fixedIncentive = 0;
                var fixedTriggered = new List<Dictionary<string, object?>>();
                foreach (var fi in fixedIncentives)
                {
                    if (!string.IsNullOrEmpty(fi.RoleId) && fi.RoleId != employee.RoleId) continue;
                    bool pass = true;
                    if (!string.IsNullOrEmpty(fi.ConditionKpiId))
                    {
                        var kpi = kpiResults.FirstOrDefault(k => k.KpiId == fi.ConditionKpiId);
                        var value = kpi?.AchievementPercent ?? 0;
                        pass = fi.ConditionOperator switch
                        {
                            ">=" => fi.ConditionValue.HasValue && value >= fi.ConditionValue.Value,
                            "<=" => fi.ConditionValue.HasValue && value <= fi.ConditionValue.Value,
                            ">"  => fi.ConditionValue.HasValue && value >  fi.ConditionValue.Value,
                            "<"  => fi.ConditionValue.HasValue && value <  fi.ConditionValue.Value,
                            "="  => fi.ConditionValue.HasValue && value == fi.ConditionValue.Value,
                            _ => true
                        };
                    }
                    if (pass)
                    {
                        fixedIncentive += fi.Amount;
                        fixedTriggered.Add(new() {
                            ["id"] = fi.Id, ["name"] = fi.Name, ["amount"] = fi.Amount,
                            ["condition_kpi_id"] = fi.ConditionKpiId,
                            ["condition_operator"] = fi.ConditionOperator,
                            ["condition_value"] = fi.ConditionValue,
                        });
                    }
                }
                Log(9.5, "Apply Fixed Incentive", new {
                    employee = employee.Name, fixed_incentive_amount = fixedIncentive, triggered = fixedTriggered
                });

                double netPayout = payoutAfterDed + mult.Amount - pen.Amount + fixedIncentive;
                if (eligibility.Status == "ineligible") netPayout = 0;
                else if (eligibility.Status == "reduced") netPayout *= (1 - eligibility.Reduction / 100);

                // Step 10 — cap
                var cap = Steps.ApplyCap(netPayout, cappingRules, employee);
                Log(10, "Apply Cap", new { employee = employee.Name, before = netPayout, after = cap.Capped, cap_hit = cap.Applied });
                netPayout = cap.Capped;

                // Step 10.5 — split
                double splitAdj = 0;
                foreach (var sr in splitRules)
                {
                    var part = sr.Participants.FirstOrDefault(p => p.RoleId == employee.RoleId);
                    if (part != null)
                    {
                        splitAdj = netPayout - (netPayout * part.SplitPercent / 100);
                        netPayout = netPayout * part.SplitPercent / 100;
                    }
                }

                var calcDetails = JsonSerializer.Serialize(new {
                    multiplier = mult,
                    kpi_deduction = kpiDed,
                    fixed_incentive = new { amount = fixedIncentive, triggered = fixedTriggered },
                    penalty = pen,
                    cap,
                    eligibility,
                    helper_trips = helperTripDetails,
                    helper_trip_bonus = helperTripAmount,
                    kpi_gross_only = grossPayout - helperTripAmount,
                }, Json.Options);

                netPayout = Math.Round(netPayout * 100) / 100;
                var payoutId = await Steps.StorePayoutAsync(
                    _db, employee, runId, req.PlanId, req.Period,
                    grossPayout, kpiDed.Amount, fixedIncentive, mult.Amount, pen.Amount,
                    cap.Adjustment, splitAdj, netPayout,
                    eligibility.Status,
                    JsonSerializer.Serialize(eligibility.Details, Json.Options),
                    calcDetails, kpiResults, ct);
                Log(11, "Store Payout", new { employee = employee.Name, payout_id = payoutId, net_payout = netPayout });

                // Step 12 — approval (real runs only)
                if (!req.IsSimulation)
                {
                    await Steps.CreateApprovalAsync(_db, payoutId, ct);
                    Log(12, "Create Approval", new { employee = employee.Name, status = "submitted" });
                }

                allPayouts.Add(new() {
                    ["id"] = payoutId,
                    ["employee_id"] = employee.Id,
                    ["employee_name"] = employee.Name,
                    ["role_name"] = employee.RoleName,
                    ["gross_payout"] = grossPayout,
                    ["net_payout"] = netPayout,
                    ["eligibility_status"] = eligibility.Status,
                });
            }

            // Step 13 — finalize run
            var total = allPayouts.Sum(p => Convert.ToDouble(p["net_payout"]));
            total = Math.Round(total * 100) / 100;
            await _db.ExecuteAsync(@"
                UPDATE calculation_runs
                SET status = 'completed', total_payout = @total, employee_count = @count,
                    completed_at = NOW(), calculation_details = @det::text
                WHERE id = @id",
                new {
                    total, count = allPayouts.Count, id = runId,
                    det = JsonSerializer.Serialize(new { steps = stepsLog }, Json.Options)
                }, ct: ct);
            Log(13, "Complete", new { total_payout = total, employee_count = allPayouts.Count });

            return new PipelineRunResult
            {
                RunId = runId, PlanId = req.PlanId, Period = req.Period, Status = "completed",
                IsSimulation = req.IsSimulation, TotalPayout = total, EmployeeCount = allPayouts.Count,
                Payouts = allPayouts, Steps = stepsLog,
            };
        }
        catch
        {
            await _db.ExecuteAsync(
                "UPDATE calculation_runs SET status = 'failed', completed_at = NOW() WHERE id = @id",
                new { id = runId }, ct: ct);
            throw;
        }
    }
}
