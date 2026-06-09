using System.Text.Json;
using Commission.Api.Data;
using Dapper;

namespace Commission.Api.Engine;

/// <summary>
/// 13-step calculation orchestrator. All SQL targets the new commissionv1 schema.
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
            SELECT uid AS Uid, name AS Name, description AS Description, status AS Status,
                   plan_type AS PlanType,
                   effective_from AS EffectiveFrom, effective_to AS EffectiveTo,
                   base_payout AS BasePayout, currency_uid AS CurrencyUid, org_uid AS OrgUid,
                   created_by AS CreatedBy
            FROM commission_plans WHERE uid = @uid",
            new { uid = req.PlanUid }, ct: ct)
            ?? throw new InvalidOperationException("Plan not found");

        // Currency is mandatory — refuse to run without it.
        if (string.IsNullOrWhiteSpace(plan.CurrencyUid))
            throw new InvalidOperationException(
                $"Plan '{plan.Name}' has no currency configured. Set commission_plans.currency_uid before running the pipeline.");

        // Look up the currency code for use by Steps (exchange-rate normalization).
        var baseCurrencyCode = await _db.QuerySingleOrDefaultAsync<string>(
            "SELECT code FROM currency WHERE uid = @uid", new { uid = plan.CurrencyUid }, ct: ct)
            ?? throw new InvalidOperationException(
                $"Currency uid '{plan.CurrencyUid}' on plan '{plan.Name}' does not exist in the currency table.");

        // 1a. Run-claim lock via the calculation_locks table.
        // One in-flight pipeline at a time per (plan, period). Prevents a manual
        // /calculate click from racing the cron pass on the dedup DELETE and
        // ending up with duplicate payouts. Simulations skip this — they live
        // in their own is_simulation=true rows and don't collide.
        //
        // Why a table and not pg_advisory_lock: advisory locks are scoped to
        // the *session* (physical connection). Dapper over Npgsql pools, so
        // sequential _db.ExecuteAsync calls can each pick different connections
        // — acquire on A, "release" on B, leaving A's lock held until that
        // pooled connection is reaped. A small claim table sidesteps that
        // entirely and self-heals stale locks from crashed runs.
        var runUid = Guid.NewGuid().ToString();
        bool lockHeld = false;
        const int staleMinutes = 30;
        if (!req.IsSimulation)
        {
            // Sweep any stale lock for this (plan, period) — handles the case
            // where a prior run crashed before releasing.
            await _db.ExecuteAsync(@"
                DELETE FROM calculation_locks
                WHERE plan_uid = @p AND period = @period
                  AND locked_at < NOW() - (@stale || ' minutes')::interval",
                new { p = req.PlanUid, period = req.Period, stale = staleMinutes.ToString() }, ct: ct);

            // Try to claim the slot. INSERT … ON CONFLICT DO NOTHING returns 0
            // rows if a live lock already exists (another run is in flight).
            var claimed = await _db.ExecuteAsync(@"
                INSERT INTO calculation_locks (plan_uid, period, locked_by, locked_at)
                VALUES (@p, @period, @by, NOW())
                ON CONFLICT (plan_uid, period) DO NOTHING",
                new { p = req.PlanUid, period = req.Period, by = runUid }, ct: ct);

            if (claimed == 0)
                throw new InvalidOperationException(
                    $"Another calculation is already running for plan '{plan.Name}' period '{req.Period}'. Try again in a moment.");
            lockHeld = true;
        }

        try
        {
            // 1b. Dedup — drop any prior draft (approval_status='pending') for this
            // (plan, period) before opening the new run. kpi_results + approval_log
            // cascade-delete with the payout. Submitted/approved payouts are left alone.
            if (req.ReplaceDraft && !req.IsSimulation)
            {
                await _db.ExecuteAsync(@"
                    DELETE FROM employee_payouts
                    WHERE plan_uid = @p AND period = @period AND approval_status = 'pending'",
                    new { p = req.PlanUid, period = req.Period }, ct: ct);
                await _db.ExecuteAsync(@"
                    DELETE FROM calculation_runs
                    WHERE plan_uid = @p AND period = @period AND is_simulation = FALSE
                      AND NOT EXISTS (SELECT 1 FROM employee_payouts WHERE run_uid = calculation_runs.uid)",
                    new { p = req.PlanUid, period = req.Period }, ct: ct);
            }

            // 2. Create run row
            await _db.ExecuteAsync(@"
                INSERT INTO calculation_runs (uid, plan_uid, period, status, is_simulation, simulation_params, created_by, source_system)
                VALUES (@uid, @plan, @period, 'running', @sim, @params::jsonb, @by, 'engine')",
                new {
                    uid = runUid, plan = req.PlanUid, period = req.Period,
                    sim = req.IsSimulation,
                    @params = JsonSerializer.Serialize(req.Overrides ?? new()),
                    by = req.CreatedBy
                }, ct: ct);

            // 3. Eligible employees: roles + sales-offices + optional employee whitelist
            var planRoles = (await _db.QueryAsync<string>(
                "SELECT role_uid FROM plan_roles WHERE plan_uid = @p", new { p = req.PlanUid }, ct: ct)).ToList();
            var planOffices = (await _db.QueryAsync<string>(
                "SELECT sales_office_uid FROM plan_sales_offices WHERE plan_uid = @p", new { p = req.PlanUid }, ct: ct)).ToList();

            List<Employee> employees;
            if (planRoles.Count > 0)
            {
                employees = (await _db.QueryAsync<Employee>(@"
                    SELECT e.uid AS Uid, e.emp_code AS EmpCode,
                           e.name AS Name, e.email AS Email, e.mobile AS Mobile,
                           e.role_uid AS RoleUid, e.role_code AS RoleCode, e.role_name_en AS RoleNameEn,
                           e.designation AS Designation, e.department AS Department,
                           e.sales_office_uid AS SalesOfficeUid, e.sales_office_name AS SalesOfficeName,
                           e.branch_uid AS BranchUid, e.reports_to_uid AS ReportsToUid,
                           e.base_salary AS BaseSalary, e.hire_date AS HireDate, e.is_active AS IsActive
                    FROM employees e
                    WHERE e.is_active = TRUE AND e.role_uid = ANY(@roles)",
                    new { roles = planRoles.ToArray() }, ct: ct)).ToList();
            }
            else employees = new();

            List<Employee> filteredEmps = planOffices.Count > 0
                ? employees.Where(e => e.SalesOfficeUid != null && planOffices.Contains(e.SalesOfficeUid)).ToList()
                : employees;

            // Optional employee whitelist
            var planEmployees = (await _db.QueryAsync<string>(
                "SELECT emp_uid FROM plan_employees WHERE plan_uid = @p", new { p = req.PlanUid }, ct: ct)).ToList();
            if (planEmployees.Count > 0)
            {
                var allowedEmps = new HashSet<string>(planEmployees);
                filteredEmps = filteredEmps.Where(e => allowedEmps.Contains(e.Uid)).ToList();
            }

            if (filteredEmps.Count == 0)
            {
                Log(0, "No Eligible Employees", new {
                    planRoles = planRoles.Count,
                    planOffices = planOffices.Count,
                    totalEmployees = employees.Count,
                });
                await _db.ExecuteAsync(
                    "UPDATE calculation_runs SET status = 'completed', total_payout = 0, completed_time = NOW(), modified_time = NOW() WHERE uid = @uid",
                    new { uid = runUid }, ct: ct);
                return new PipelineRunResult
                {
                    RunUid = runUid, PlanUid = req.PlanUid, Period = req.Period, Status = "completed",
                    IsSimulation = req.IsSimulation, Steps = stepsLog,
                    Message = "No eligible employees found for this plan configuration"
                };
            }

            if (!string.IsNullOrEmpty(req.EmpUid))
                filteredEmps = filteredEmps.Where(e => e.Uid == req.EmpUid).ToList();

            Log(0, "Initialize", new { employee_count = filteredEmps.Count, plan = plan.Name });

            // 4. Load plan KPIs + slabs + rules + modifiers (batch fetch)
            var planKpis = (await _db.QueryAsync<PlanKpi>(@"
                SELECT pk.uid AS Uid, pk.plan_uid AS PlanUid, pk.kpi_uid AS KpiUid,
                       pk.weight AS Weight, pk.target_value AS TargetValue, pk.slab_set_uid AS SlabSetUid,
                       k.name AS KpiName, k.code AS KpiCode, k.formula::text AS Formula,
                       k.unit AS Unit, k.direction AS Direction, k.category AS KpiCategory
                FROM plan_kpis pk JOIN kpi_definitions k ON pk.kpi_uid = k.uid
                WHERE pk.plan_uid = @p", new { p = req.PlanUid }, ct: ct)).ToList();

            var ruleSets = (await _db.QueryAsync<RuleSet>(@"
                SELECT uid AS Uid, plan_uid AS PlanUid, name AS Name, description AS Description
                FROM rule_sets WHERE plan_uid = @p", new { p = req.PlanUid }, ct: ct)).ToList();
            foreach (var rs in ruleSets)
            {
                rs.Rules = (await _db.QueryAsync<Rule>(@"
                    SELECT uid AS Uid, rule_set_uid AS RuleSetUid, parent_rule_uid AS ParentRuleUid,
                           dimension AS Dimension, rule_type AS RuleType, match_type AS MatchType,
                           match_values::text AS MatchValues, priority AS Priority,
                           valid_from AS ValidFrom, valid_to AS ValidTo,
                           conditional_logic::text AS ConditionalLogic
                    FROM rules WHERE rule_set_uid = @id", new { id = rs.Uid }, ct: ct)).ToList();
            }

            TagContext? tagCtx = null;
            try { tagCtx = await _filters.BuildTagContextAsync(ct); }
            catch { tagCtx = new(); }

            var asOf = req.Period.Contains('-')
                ? DateTime.Parse($"{req.Period[..7]}-28")
                : DateTime.UtcNow.Date;

            var eligibilityRules = (await _db.QueryAsync<EligibilityRule>(@"
                SELECT uid AS Uid, plan_uid AS PlanUid, metric AS Metric, operator AS Operator,
                       threshold AS Threshold, action AS Action,
                       reduction_percent AS ReductionPercent, is_active AS IsActive
                FROM eligibility_rules WHERE plan_uid = @p AND is_active = TRUE",
                new { p = req.PlanUid }, ct: ct)).ToList();

            var multiplierRules = (await _db.QueryAsync<MultiplierRule>(@"
                SELECT uid AS Uid, plan_uid AS PlanUid, name AS Name, type AS Type,
                       condition_metric AS ConditionMetric, condition_operator AS ConditionOperator,
                       condition_value AS ConditionValue, multiplier_value AS MultiplierValue,
                       stacking_mode AS StackingMode, is_active AS IsActive
                FROM multiplier_rules WHERE plan_uid = @p AND is_active = TRUE",
                new { p = req.PlanUid }, ct: ct)).ToList();

            var kpiDeductionRules = (await _db.QueryAsync<KpiDeductionRule>(@"
                SELECT uid AS Uid, plan_uid AS PlanUid, kpi_uid AS KpiUid, role_uid AS RoleUid,
                       name AS Name, metric_type AS MetricType,
                       min_value AS MinValue, max_value AS MaxValue,
                       min_inclusive AS MinInclusive, max_inclusive AS MaxInclusive,
                       deduction_percent AS DeductionPercent, priority AS Priority, is_active AS IsActive
                FROM kpi_deduction_rules WHERE plan_uid = @p AND is_active = TRUE",
                new { p = req.PlanUid }, ct: ct)).ToList();

            var penaltyRules = (await _db.QueryAsync<PenaltyRule>(@"
                SELECT uid AS Uid, plan_uid AS PlanUid, name AS Name,
                       trigger_metric AS TriggerMetric, trigger_operator AS TriggerOperator,
                       trigger_value AS TriggerValue, penalty_type AS PenaltyType,
                       penalty_value AS PenaltyValue, is_active AS IsActive
                FROM penalty_rules WHERE plan_uid = @p AND is_active = TRUE",
                new { p = req.PlanUid }, ct: ct)).ToList();

            var cappingRules = (await _db.QueryAsync<CappingRule>(@"
                SELECT uid AS Uid, plan_uid AS PlanUid, cap_type AS CapType,
                       cap_value AS CapValue, is_active AS IsActive
                FROM capping_rules WHERE plan_uid = @p AND is_active = TRUE",
                new { p = req.PlanUid }, ct: ct)).ToList();

            var monthlyTargets = (await _db.QueryAsync<MonthlyTarget>(@"
                SELECT uid AS Uid, plan_uid AS PlanUid, kpi_uid AS KpiUid, role_uid AS RoleUid,
                       period AS Period, target_value AS TargetValue
                FROM plan_kpi_monthly_targets WHERE plan_uid = @p AND period = @period",
                new { p = req.PlanUid, period = req.Period }, ct: ct)).ToList();

            var fixedIncentives = (await _db.QueryAsync<FixedIncentiveRule>(@"
                SELECT uid AS Uid, plan_uid AS PlanUid, role_uid AS RoleUid, period AS Period,
                       name AS Name, amount AS Amount,
                       condition_kpi_uid AS ConditionKpiUid, condition_operator AS ConditionOperator,
                       condition_value AS ConditionValue, is_active AS IsActive
                FROM plan_fixed_incentives
                WHERE plan_uid = @p AND is_active = TRUE AND (period IS NULL OR period = @period)",
                new { p = req.PlanUid, period = req.Period }, ct: ct)).ToList();

            var splitRules = (await _db.QueryAsync<SplitRule>(@"
                SELECT uid AS Uid, plan_uid AS PlanUid, name AS Name,
                       trigger_condition AS TriggerCondition, is_active AS IsActive
                FROM split_rules WHERE plan_uid = @p AND is_active = TRUE",
                new { p = req.PlanUid }, ct: ct)).ToList();
            foreach (var sr in splitRules)
            {
                sr.Participants = (await _db.QueryAsync<SplitParticipant>(@"
                    SELECT uid AS Uid, split_rule_uid AS SplitRuleUid, role_uid AS RoleUid,
                           split_percent AS SplitPercent
                    FROM split_participants WHERE split_rule_uid = @id", new { id = sr.Uid }, ct: ct)).ToList();
            }

            // Slab sets keyed by kpi_uid
            var slabSets = new Dictionary<string, List<SlabSet>>();
            foreach (var pk in planKpis)
            {
                var sets = (await _db.QueryAsync<SlabSet>(@"
                    SELECT uid AS Uid, name AS Name, type AS Type,
                           plan_uid AS PlanUid, kpi_uid AS KpiUid, role_uid AS RoleUid
                    FROM slab_sets WHERE plan_uid = @p AND kpi_uid = @k",
                    new { p = plan.Uid, k = pk.KpiUid }, ct: ct)).ToList();
                foreach (var ss in sets)
                {
                    ss.Tiers = (await _db.QueryAsync<SlabTier>(@"
                        SELECT uid AS Uid, slab_set_uid AS SlabSetUid, tier_order AS TierOrder,
                               min_percent AS MinPercent, max_percent AS MaxPercent,
                               rate AS Rate, rate_type AS RateType,
                               min_inclusive AS MinInclusive, max_inclusive AS MaxInclusive
                        FROM slab_tiers WHERE slab_set_uid = @s ORDER BY tier_order",
                        new { s = ss.Uid }, ct: ct)).ToList();
                }
                slabSets[pk.KpiUid] = sets;
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
                    _db, employee.Uid, req.Period, employee.SalesOfficeUid, employee.RoleUid,
                    baseCurrencyCode, ct);
                Log(1, "Fetch Transactions", new { employee = employee.Name, count = transactions.Count });

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
                        t.KpiUid == pk.KpiUid && (string.IsNullOrEmpty(t.RoleUid) || t.RoleUid == employee.RoleUid));
                    double? targetOverride = null;
                    if (req.Overrides != null && req.Overrides.TryGetValue("targets", out var tobj) && tobj is JsonElement tEl
                        && tEl.ValueKind == JsonValueKind.Object && tEl.TryGetProperty(pk.KpiUid, out var override1))
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

                    var slabCandidates = slabSets.TryGetValue(pk.KpiUid, out var ss) ? ss : new();
                    SlabSet? chosen = null;
                    if (!string.IsNullOrEmpty(pk.SlabSetUid))
                        chosen = slabCandidates.FirstOrDefault(s => s.Uid == pk.SlabSetUid);
                    if (chosen is null)
                        chosen = slabCandidates.FirstOrDefault(s => s.RoleUid == employee.RoleUid)
                              ?? slabCandidates.FirstOrDefault(s => string.IsNullOrEmpty(s.RoleUid));

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
                        KpiUid = pk.KpiUid, KpiName = pk.KpiName, KpiCode = pk.KpiCode,
                        KpiCategory = pk.KpiCategory, Unit = pk.Unit,
                        TargetValue = ach.Target, ActualValue = ach.Actual, AchievementPercent = ach.Percent,
                        SlabRate = slab.Rate, SlabType = slab.Type,
                        RawPayout = rawPayout.Amount, WeightedPayout = weighted, Weight = pk.Weight,
                        CalculationDetails = JsonSerializer.Serialize(new {
                            achievement = ach, slab, payout = rawPayout
                        }, Json.Options),
                        // Self-documenting columns — formula's real inputs persisted alongside its output.
                        NumeratorValue       = ach.Numerator,
                        DenominatorValue     = ach.Denominator,
                        NumeratorUnit        = ach.NumeratorUnit,
                        DenominatorUnit      = ach.DenominatorUnit,
                        ActualUnit           = ach.ActualUnit,
                        GoalThresholdPercent = ach.Target,        // canonical name for the % goal
                        FormulaType          = ach.FormulaType,
                    });
                }

                // Step 7 — aggregate + helper-trip bonus
                var grossPayout = Steps.AggregateKpis(kpiResults);
                double helperTripAmount = 0;
                Dictionary<string, object?>? helperTripDetails = null;
                try
                {
                    var tiers = (await _db.QueryDynamicAsync(
                        "SELECT team_size, rate_per_person FROM helper_trip_rates WHERE plan_uid = @p",
                        new { p = req.PlanUid }, ct: ct)).ToList();
                    if (tiers.Count == 0)
                        tiers = (await _db.QueryDynamicAsync(
                            "SELECT team_size, rate_per_person FROM helper_trip_rates WHERE plan_uid IS NULL", ct: ct)).ToList();

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
                            SELECT t.uid, t.trip_number, t.trip_date, t.trip_end_date, t.days_count,
                                   (SELECT COUNT(*) FROM trip_participants tp2 WHERE tp2.trip_uid = t.uid) AS team_size
                            FROM trips t JOIN trip_participants tp ON tp.trip_uid = t.uid
                            WHERE tp.emp_uid = @e AND t.period = @p AND t.status = 'completed'",
                            new { e = employee.Uid, p = req.Period }, ct: ct)).ToList();

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
                catch { /* trips data missing */ }

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
                    if (!string.IsNullOrEmpty(fi.RoleUid) && fi.RoleUid != employee.RoleUid) continue;
                    bool pass = true;
                    if (!string.IsNullOrEmpty(fi.ConditionKpiUid))
                    {
                        var kpi = kpiResults.FirstOrDefault(k => k.KpiUid == fi.ConditionKpiUid);
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
                            ["uid"] = fi.Uid, ["name"] = fi.Name, ["amount"] = fi.Amount,
                            ["condition_kpi_uid"] = fi.ConditionKpiUid,
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
                    var part = sr.Participants.FirstOrDefault(p => p.RoleUid == employee.RoleUid);
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
                var payoutUid = await Steps.StorePayoutAsync(
                    _db, employee, runUid, req.PlanUid, req.Period,
                    grossPayout, kpiDed.Amount, fixedIncentive, mult.Amount, pen.Amount,
                    cap.Adjustment, splitAdj, netPayout,
                    eligibility.Status,
                    JsonSerializer.Serialize(eligibility.Details, Json.Options),
                    calcDetails, kpiResults, ct,
                    planName: plan.Name, currencyUid: plan.CurrencyUid, currencyCode: baseCurrencyCode);
                Log(11, "Store Payout", new { employee = employee.Name, payout_uid = payoutUid, net_payout = netPayout });

                // Step 12 — approval (only when caller asks for auto-submit).
                // Cron sets AutoSubmit on the last day of the month; manual /calculate
                // sets it when today >= last day of the run's period. Otherwise the
                // payout stays in 'pending' (draft) state.
                if (!req.IsSimulation && req.AutoSubmit)
                {
                    await Steps.CreateApprovalAsync(_db, payoutUid, ct);
                    Log(12, "Create Approval", new { employee = employee.Name, status = "submitted" });
                }

                allPayouts.Add(new() {
                    ["uid"] = payoutUid,
                    ["emp_uid"] = employee.Uid,
                    ["employee_name"] = employee.Name,
                    ["role_name"] = employee.RoleNameEn,
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
                    completed_time = NOW(), modified_time = NOW(),
                    calculation_details = @det::jsonb
                WHERE uid = @uid",
                new {
                    total, count = allPayouts.Count, uid = runUid,
                    det = JsonSerializer.Serialize(new { steps = stepsLog }, Json.Options)
                }, ct: ct);
            Log(13, "Complete", new { total_payout = total, employee_count = allPayouts.Count });

            // Audit row — preserves a history of what the pipeline produced even
            // after the next daily refresh deletes the underlying calculation_runs
            // row. Submitted/locked payouts already audit themselves via approval_log.
            if (!req.IsSimulation)
            {
                await _db.ExecuteAsync(@"
                    INSERT INTO audit_trail (uid, entity_type, entity_uid, action, changes, performed_by, source_system)
                    VALUES (@uid, 'calculation-run', @runUid, @action, @ch::jsonb, @by, 'engine')",
                    new {
                        uid = Guid.NewGuid().ToString(),
                        runUid,
                        action = req.AutoSubmit ? "submitted" : "refreshed",
                        ch = JsonSerializer.Serialize(new {
                            plan_uid = req.PlanUid,
                            period = req.Period,
                            total_payout = total,
                            employee_count = allPayouts.Count,
                            auto_submit = req.AutoSubmit,
                            replaced_draft = req.ReplaceDraft,
                        }, Json.Options),
                        by = req.CreatedBy ?? "engine",
                    }, ct: ct);
            }

            return new PipelineRunResult
            {
                RunUid = runUid, PlanUid = req.PlanUid, Period = req.Period, Status = "completed",
                IsSimulation = req.IsSimulation, TotalPayout = total, EmployeeCount = allPayouts.Count,
                Payouts = allPayouts, Steps = stepsLog,
            };
        }
        catch
        {
            await _db.ExecuteAsync(
                "UPDATE calculation_runs SET status = 'failed', completed_time = NOW(), modified_time = NOW() WHERE uid = @uid",
                new { uid = runUid }, ct: ct);
            throw;
        }
        finally
        {
            // Release the run-claim row. Match on locked_by = runUid so we never
            // delete someone else's claim if this code is somehow re-entered.
            // If release fails (DB unreachable, transient error), the stale-lock
            // sweep at the top of the next attempt will clear it after `staleMinutes`.
            if (lockHeld)
            {
                try
                {
                    await _db.ExecuteAsync(@"
                        DELETE FROM calculation_locks
                        WHERE plan_uid = @p AND period = @period AND locked_by = @by",
                        new { p = req.PlanUid, period = req.Period, by = runUid }, ct: ct);
                }
                catch { /* next run's stale-sweep will reclaim */ }
            }
        }
    }
}
