using Commission.Api.Data;
using Dapper;

namespace Commission.Api.Engine;

/// <summary>
/// All 13 pipeline steps as static helpers — preserves the file-per-step
/// structure of the JS code in one cohesive C# file. Each function maps 1:1
/// to its server/src/engine/stepNN_*.js counterpart.
/// </summary>
public static class Steps
{
    // -----------------------------------------------------------------
    // Step 1 — fetchScopedTransactions
    //   Self + reports_to descendants + currency normalization + event promotion
    // -----------------------------------------------------------------
    public static async Task<List<Transaction>> FetchScopedTransactionsAsync(
        IDb db, string employeeId, string period, string? territoryId, string? roleId,
        CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(employeeId)) return new();

        var allEmployees = (await db.QueryDynamicAsync(
            "SELECT id, reports_to FROM employees WHERE is_active = 1", ct: ct)).ToList();
        if (allEmployees.Count == 0) return new();

        var childrenByManager = new Dictionary<string, List<string>>();
        foreach (var e in allEmployees)
        {
            string? rt = e.reports_to;
            if (string.IsNullOrEmpty(rt)) continue;
            if (!childrenByManager.TryGetValue(rt!, out var list)) { list = new(); childrenByManager[rt!] = list; }
            list.Add((string)e.id);
        }

        var scoped = new List<string>();
        var visited = new HashSet<string>();
        var queue = new Queue<string>();
        queue.Enqueue(employeeId);
        while (queue.Count > 0)
        {
            var curr = queue.Dequeue();
            if (!visited.Add(curr)) continue;
            scoped.Add(curr);
            if (childrenByManager.TryGetValue(curr, out var kids))
                foreach (var k in kids) queue.Enqueue(k);
        }

        // Supervisor fallback (same as JS): if scope still just self, expand to territory subtree
        var supervisorRoles = new HashSet<string> {
            "role-route-sup", "role-ss", "role-asm", "role-rsm", "role-depot-mgr"
        };
        if (roleId != null && supervisorRoles.Contains(roleId) && scoped.Count <= 1 && !string.IsNullOrEmpty(territoryId))
        {
            var allTerrs = (await db.QueryDynamicAsync("SELECT id, parent_id FROM territories", ct: ct)).ToList();
            var subtree = new HashSet<string> { territoryId! };
            bool changed = true;
            while (changed)
            {
                changed = false;
                foreach (var t in allTerrs)
                {
                    string id = t.id; string? pid = t.parent_id;
                    if (!subtree.Contains(id) && pid != null && subtree.Contains(pid))
                    { subtree.Add(id); changed = true; }
                }
            }
            if (subtree.Count > 0)
            {
                var rows = await db.QueryDynamicAsync(
                    "SELECT id FROM employees WHERE is_active = 1 AND id <> @e AND territory_id = ANY(@ts)",
                    new { e = employeeId, ts = subtree.ToArray() }, ct: ct);
                foreach (var r in rows)
                {
                    string id = r.id;
                    if (visited.Add(id)) scoped.Add(id);
                }
            }
        }

        // Standard transactions joined with products + customers
        var txns = (await db.QueryAsync<Transaction>(@"
            SELECT t.id, t.employee_id AS EmployeeId, t.customer_id AS CustomerId, t.product_id AS ProductId,
                   t.transaction_type AS TransactionType, t.quantity, t.amount,
                   t.transaction_date AS TransactionDate, t.period, t.territory_id AS TerritoryId,
                   COALESCE(t.currency, 'AED') AS Currency,
                   COALESCE(t.base_amount, t.amount) AS BaseAmount,
                   COALESCE(t.exchange_rate, 1.0) AS ExchangeRate,
                   p.name AS ProductName, p.category AS ProductCategory, p.sku AS Sku,
                   p.is_strategic AS IsStrategic, p.is_new_launch AS IsNewLaunch, p.tags AS ProductTags,
                   c.name AS CustomerName, c.channel AS CustomerChannel,
                   c.customer_group AS CustomerGroup, c.customer_group_name AS CustomerGroupName,
                   c.tags AS CustomerTags
            FROM transactions t
            JOIN products p ON t.product_id = p.id
            JOIN customers c ON t.customer_id = c.id
            WHERE t.employee_id = ANY(@emps) AND t.period = @period
            ORDER BY t.transaction_date",
            new { emps = scoped.ToArray(), period }, ct: ct)).ToList();

        // Currency normalization (set base_amount where missing)
        var rates = new Dictionary<string, double> { ["AED"] = 1.0 };
        try
        {
            var rows = await db.QueryDynamicAsync(
                "SELECT from_currency, to_currency, rate FROM exchange_rates WHERE to_currency = 'AED' OR from_currency = 'AED'", ct: ct);
            foreach (var r in rows)
            {
                string from = r.from_currency, to = r.to_currency;
                double rate = Convert.ToDouble(r.rate);
                if (from == "AED") rates[to] = 1.0 / rate;
                else if (to == "AED") rates[from] = rate;
            }
        }
        catch { /* exchange_rates may be empty/missing */ }

        foreach (var t in txns)
        {
            var ccy = string.IsNullOrEmpty(t.Currency) ? "AED" : t.Currency;
            var rate = rates.TryGetValue(ccy, out var r) ? r : 1.0;
            if (t.BaseAmount == 0) t.BaseAmount = Math.Round(t.Amount * rate * 100) / 100;
            t.ExchangeRate = rate;
            t.Currency = ccy;
        }

        // §5 — promote validated commission_events to synthetic 'event' transactions
        List<dynamic> events;
        try
        {
            events = (await db.QueryDynamicAsync(@"
                SELECT id, event_type, employee_id, reference_id, reference_type,
                       value, metadata, event_date, period
                FROM commission_events
                WHERE employee_id = ANY(@emps) AND period = @period AND validated = 1",
                new { emps = scoped.ToArray(), period }, ct: ct)).ToList();
        }
        catch { events = new(); }

        foreach (var e in events)
        {
            var val = e.value is null ? 0.0 : Convert.ToDouble(e.value);
            txns.Add(new Transaction
            {
                Id = $"evt-{e.id}",
                EmployeeId = e.employee_id,
                CustomerId = null,
                ProductId = null,
                TransactionType = "event",
                EventType = e.event_type,
                Quantity = val,
                Amount = val,
                BaseAmount = val,
                Currency = "AED",
                ExchangeRate = 1.0,
                TransactionDate = e.event_date is DateTime d ? d : DateTime.UtcNow,
                Period = e.period,
                TerritoryId = territoryId,
                EventSource = true,
                ReferenceId = e.reference_id,
                ProductTags = "[]",
                CustomerTags = "[]",
            });
        }

        return txns;
    }

    // -----------------------------------------------------------------
    // Step 3 — KPI Achievement (calls FormulaEvaluator, fallback to legacy)
    // -----------------------------------------------------------------
    public static async Task<KpiAchievement> CalculateKpiAchievementAsync(
        FormulaEvaluator evaluator, IDb db,
        List<Transaction> transactions, PlanKpi planKpi, Employee employee, string period,
        double? targetOverride = null, CancellationToken ct = default)
    {
        double? actual = null;
        try { actual = await evaluator.EvaluateAsync(planKpi.Formula, transactions, employee, period, ct); }
        catch { actual = null; }
        if (actual is null)
            actual = await LegacyCalculateAsync(db, transactions, planKpi, employee, period, ct);

        double target = targetOverride ?? planKpi.TargetValue;
        double percent;
        if (planKpi.Direction == "lower_is_better")
            percent = target > 0 ? Math.Max(0, (2 * target - actual.Value) / target * 100) : 0;
        else
            percent = target > 0 ? (actual.Value / target) * 100 : 0;

        return new KpiAchievement
        {
            Actual = Math.Round(actual.Value * 100) / 100,
            Target = target,
            Percent = Math.Round(percent * 100) / 100,
        };
    }

    // Mirrors legacyCalculate() in step03_kpiAchievement.js — hardcoded calculators
    private static async Task<double> LegacyCalculateAsync(
        IDb db, List<Transaction> transactions, PlanKpi planKpi, Employee employee, string period, CancellationToken ct)
    {
        var sales       = transactions.Where(t => t.TransactionType == "sale").ToList();
        var returns     = transactions.Where(t => t.TransactionType == "return").ToList();
        var collections = transactions.Where(t => t.TransactionType == "collection").ToList();

        switch (planKpi.KpiCode)
        {
            case "TOTAL_REVENUE": return sales.Sum(t => t.Amount);
            case "REVENUE_GROWTH":
            {
                var currentRev = sales.Sum(t => t.Amount);
                var parts = period.Split('-');
                if (parts.Length != 2 || !int.TryParse(parts[0], out var y) || !int.TryParse(parts[1], out var m)) return 0;
                var prevPeriod = $"{y - 1:D4}-{m:D2}";
                var prev = await db.QuerySingleOrDefaultAsync<double>(
                    "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE employee_id = @e AND period = @p AND transaction_type = 'sale'",
                    new { e = employee.Id, p = prevPeriod }, ct: ct);
                return prev > 0 ? ((currentRev - prev) / prev) * 100 : 0;
            }
            case "UNITS_SOLD":   return sales.Sum(t => t.Quantity);
            case "OUTLET_COVERAGE": return sales.Select(t => t.CustomerId).Distinct().Count();
            case "LINES_PER_CALL":
            {
                var uProds = sales.Select(t => t.ProductId).Distinct().Count();
                var uCusts = sales.Select(t => t.CustomerId).Distinct().Count();
                return uCusts > 0 ? (double)uProds / uCusts : 0;
            }
            case "COLLECTION_PERCENT":
            {
                var ts = sales.Sum(t => t.Amount);
                var tc = collections.Sum(t => t.Amount);
                return ts > 0 ? (tc / ts) * 100 : 0;
            }
            case "RETURN_PERCENT":
            {
                var ts = sales.Sum(t => t.Amount);
                var tr = returns.Sum(t => t.Amount);
                return ts > 0 ? (tr / ts) * 100 : 0;
            }
            case "STRATEGIC_SKU_REV": return sales.Where(t => t.IsStrategic == 1).Sum(t => t.Amount);
            case "NEW_LAUNCH_SALES":  return sales.Where(t => t.IsNewLaunch == 1).Sum(t => t.Amount);
            case "NEW_CUSTOMERS":     return sales.Select(t => t.CustomerId).Distinct().Count();
            case "TEAM_REVENUE":
            {
                var reps = await db.QueryDynamicAsync(
                    "SELECT id FROM employees WHERE reports_to = @e", new { e = employee.Id }, ct: ct);
                double team = 0;
                foreach (var r in reps)
                {
                    var v = await db.QuerySingleOrDefaultAsync<double>(
                        "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE employee_id = @e AND period = @p AND transaction_type = 'sale'",
                        new { e = (string)r.id, p = period }, ct: ct);
                    team += v;
                }
                return team;
            }
            case "TEAM_TARGET_ACH": return 90;
            case "REV_PER_OUTLET":
            {
                var rev = sales.Sum(t => t.Amount);
                var outlets = sales.Select(t => t.CustomerId).Distinct().Count();
                return outlets > 0 ? rev / outlets : 0;
            }
            case "OTD_PERCENT":  return 92;
            case "GROSS_MARGIN": return 28;
            default: return 0;
        }
    }

    // -----------------------------------------------------------------
    // Step 4 — Determine Slab
    // -----------------------------------------------------------------
    public static SlabResult DetermineSlab(double percent, SlabSet? slabSet)
    {
        if (slabSet is null)
        {
            return new SlabResult
            {
                Type = "linear",
                Rate = percent >= 70 ? Math.Min(percent / 100, 1.5) * 5 : 0,
                RateType = "percentage",
                Details = "No slab configured, using linear rate",
            };
        }
        return slabSet.Type switch
        {
            "step"        => StepSlab(percent, slabSet.Tiers),
            "progressive" => ProgressiveSlab(percent, slabSet.Tiers),
            "accelerator" => AcceleratorSlab(percent, slabSet.Tiers),
            _ => new SlabResult { Type = "unknown", Rate = 0, Details = $"Unknown slab type: {slabSet.Type}" }
        };
    }

    private static SlabResult StepSlab(double percent, List<SlabTier> tiers)
    {
        SlabTier? matched = null;
        foreach (var tier in tiers)
        {
            var max = tier.MaxPercent ?? double.PositiveInfinity;
            bool minInc = tier.MinInclusive != 0;
            bool maxInc = tier.MaxInclusive != 0;
            bool minOk = minInc ? percent >= tier.MinPercent : percent > tier.MinPercent;
            bool maxOk = !tier.MaxPercent.HasValue || (maxInc ? percent <= max : percent < max);
            if (minOk && maxOk) { matched = tier; break; }
            if (!tier.MaxPercent.HasValue && percent >= tier.MinPercent) { matched = tier; break; }
        }
        var appliedPoints = matched is null ? 0 : Math.Max(0, percent - matched.MinPercent);
        return new SlabResult
        {
            Type = "step",
            Rate = matched?.Rate ?? 0,
            RateType = matched?.RateType ?? "percentage",
            AppliedPoints = Math.Round(appliedPoints * 100) / 100,
            Tier = matched?.TierOrder ?? 0,
            Details = matched is null ? "Below minimum tier"
                : $"Tier {matched.TierOrder}: {matched.MinPercent}%-{matched.MaxPercent?.ToString() ?? "∞"}% = {matched.Rate}%"
        };
    }

    private static SlabResult ProgressiveSlab(double percent, List<SlabTier> tiers)
    {
        double totalRate = 0, totalPoints = 0;
        var breakdown = new List<Dictionary<string, object?>>();
        foreach (var tier in tiers)
        {
            var max = tier.MaxPercent ?? double.PositiveInfinity;
            if (percent <= tier.MinPercent) break;
            var applicable = Math.Min(percent, max) - tier.MinPercent;
            var contribution = tier.RateType == "per_achievement_point"
                ? applicable * tier.Rate
                : (applicable * tier.Rate / 100);
            totalRate += contribution;
            totalPoints += applicable;
            breakdown.Add(new() {
                ["tier"] = tier.TierOrder,
                ["range"] = $"{tier.MinPercent}%-{tier.MaxPercent?.ToString() ?? "∞"}%",
                ["applicable_percent"] = applicable,
                ["rate"] = tier.Rate,
                ["contribution"] = contribution,
            });
        }
        return new SlabResult
        {
            Type = "progressive",
            Rate = Math.Round(totalRate * 100) / 100,
            RateType = tiers.FirstOrDefault()?.RateType ?? "percentage",
            AppliedPoints = Math.Round(totalPoints * 100) / 100,
            Tier = breakdown.Count,
            Details = breakdown,
        };
    }

    private static SlabResult AcceleratorSlab(double percent, List<SlabTier> tiers)
    {
        SlabTier? matched = null;
        double rate = 0;
        foreach (var tier in tiers)
        {
            var max = tier.MaxPercent ?? double.PositiveInfinity;
            if (percent >= tier.MinPercent && percent < max) { matched = tier; rate = tier.Rate; break; }
            if (!tier.MaxPercent.HasValue && percent >= tier.MinPercent) { matched = tier; rate = tier.Rate; break; }
        }
        return new SlabResult
        {
            Type = "accelerator",
            Rate = rate,
            RateType = matched?.RateType ?? "percentage",
            AppliedPoints = matched is null ? 0 : Math.Max(0, percent - matched.MinPercent),
            Tier = matched?.TierOrder ?? 0,
            IsAccelerated = percent > 100,
            Details = $"{(percent > 100 ? "Accelerated" : "Base")} rate: {rate}%"
        };
    }

    // -----------------------------------------------------------------
    // Step 5 — KPI Payout
    // -----------------------------------------------------------------
    public static KpiPayoutAmount CalculateKpiPayout(KpiAchievement achievement, SlabResult slab, double basePayout)
    {
        double amount = 0;
        if (slab.Type == "progressive")
        {
            amount = slab.RateType switch
            {
                "per_unit" => achievement.Actual * slab.Rate,
                "per_achievement_point" => slab.Rate,
                _ => basePayout * slab.Rate / 100,
            };
        }
        else
        {
            amount = slab.RateType switch
            {
                "percentage" => basePayout * slab.Rate / 100,
                "fixed" => slab.Rate,
                "per_unit" => achievement.Actual * slab.Rate,
                "per_achievement_point" => (slab.AppliedPoints != 0 ? slab.AppliedPoints : achievement.Percent) * slab.Rate,
                _ => 0
            };
        }
        return new KpiPayoutAmount
        {
            Amount = Math.Round(amount * 100) / 100,
            BasePayout = basePayout,
            SlabRate = slab.Rate,
            RateType = slab.RateType,
        };
    }

    // -----------------------------------------------------------------
    // Step 6 — Apply Weight
    // -----------------------------------------------------------------
    public static double ApplyWeight(double rawPayout, double weight)
        => Math.Round(rawPayout * (weight / 100) * 100) / 100;

    // -----------------------------------------------------------------
    // Step 7 — Aggregate KPIs
    // -----------------------------------------------------------------
    public static double AggregateKpis(List<KpiResultRow> kpiResults)
        => Math.Round(kpiResults.Sum(k => k.WeightedPayout) * 100) / 100;

    // -----------------------------------------------------------------
    // Step 8a — Apply KPI Deductions
    // -----------------------------------------------------------------
    public static KpiDeductionResult ApplyKpiDeductions(
        double currentPayout, List<KpiResultRow> kpiResults,
        List<KpiDeductionRule> rules, Employee employee)
    {
        if (rules is null || rules.Count == 0 || kpiResults.Count == 0)
            return new KpiDeductionResult();

        var triggered = new List<Dictionary<string, object?>>();
        double totalPct = 0;

        foreach (var kpi in kpiResults)
        {
            var kpiRules = rules
                .Where(r => (string.IsNullOrEmpty(r.RoleId) || r.RoleId == employee.RoleId) &&
                            (string.IsNullOrEmpty(r.KpiId) || r.KpiId == kpi.KpiId))
                .OrderBy(r => r.Priority).ToList();
            if (kpiRules.Count == 0) continue;

            KpiDeductionRule? selected = null;
            double selectedMetric = 0;
            foreach (var rule in kpiRules)
            {
                double mv = ComputeMetricValue(kpi, rule.MetricType ?? "shortfall_percent");
                if (InRange(mv, rule))
                {
                    if (selected is null || rule.DeductionPercent > selected.DeductionPercent)
                    { selected = rule; selectedMetric = mv; }
                }
            }

            if (selected != null)
            {
                totalPct += selected.DeductionPercent;
                triggered.Add(new() {
                    ["kpi_id"] = kpi.KpiId,
                    ["kpi_name"] = kpi.KpiName,
                    ["kpi_code"] = kpi.KpiCode,
                    ["rule_id"] = selected.Id,
                    ["rule_name"] = selected.Name,
                    ["metric_type"] = selected.MetricType,
                    ["metric_value"] = Math.Round(selectedMetric * 100) / 100,
                    ["deduction_percent"] = selected.DeductionPercent,
                });
            }
        }

        totalPct = Math.Max(0, Math.Min(100, totalPct));
        var amount = currentPayout * (totalPct / 100);
        return new KpiDeductionResult
        {
            Amount = Math.Round(amount * 100) / 100,
            TotalPercent = Math.Round(totalPct * 100) / 100,
            Triggered = triggered,
        };
    }

    private static bool InRange(double value, KpiDeductionRule r)
    {
        bool minOk = !r.MinValue.HasValue || (r.MinInclusive != 0 ? value >= r.MinValue.Value : value > r.MinValue.Value);
        bool maxOk = !r.MaxValue.HasValue || (r.MaxInclusive != 0 ? value <= r.MaxValue.Value : value < r.MaxValue.Value);
        return minOk && maxOk;
    }

    private static double ComputeMetricValue(KpiResultRow kpi, string metricType) => metricType switch
    {
        "achievement_percent" => kpi.AchievementPercent,
        "actual_value"        => kpi.ActualValue,
        _                     => Math.Max(0, 100 - kpi.AchievementPercent),  // shortfall_percent
    };

    // -----------------------------------------------------------------
    // Step 8 — Apply Multiplier
    // -----------------------------------------------------------------
    public static async Task<MultiplierResult> ApplyMultiplierAsync(
        IDb db, double grossPayout, List<MultiplierRule> rules,
        List<Transaction> transactions, Employee employee, string period,
        Dictionary<string, double>? overrides = null, CancellationToken ct = default)
    {
        if (rules is null || rules.Count == 0)
            return new MultiplierResult { Amount = 0, FinalMultiplier = 1 };

        var sales = transactions.Where(t => t.TransactionType == "sale").ToList();
        var totalSales = sales.Sum(t => t.Amount);
        var metrics = new Dictionary<string, double>();

        var parts = period.Split('-');
        if (parts.Length == 2 && int.TryParse(parts[0], out var y) && int.TryParse(parts[1], out var m))
        {
            var prevPeriod = $"{y - 1:D4}-{m:D2}";
            var prev = await db.QuerySingleOrDefaultAsync<double>(
                "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE employee_id = @e AND period = @p AND transaction_type = 'sale'",
                new { e = employee.Id, p = prevPeriod }, ct: ct);
            metrics["revenue_growth_percent"] = prev > 0 ? ((totalSales - prev) / prev) * 100 : 0;
        }

        var strategic = sales.Where(t => t.IsStrategic == 1).Sum(t => t.Amount);
        metrics["strategic_sku_percent"] = totalSales > 0 ? (strategic / totalSales) * 100 : 0;
        var newLaunch = sales.Where(t => t.IsNewLaunch == 1).Sum(t => t.Amount);
        metrics["new_launch_percent"] = totalSales > 0 ? (newLaunch / totalSales) * 100 : 0;

        if (overrides != null) foreach (var kv in overrides) metrics[kv.Key] = kv.Value;

        var applied = new List<Dictionary<string, object?>>();
        var matched = new List<(double Value, string Mode)>();

        foreach (var rule in rules)
        {
            metrics.TryGetValue(rule.ConditionMetric, out var mv);
            bool passes = rule.ConditionOperator switch
            {
                ">=" => mv >= rule.ConditionValue,
                "<=" => mv <= rule.ConditionValue,
                ">"  => mv >  rule.ConditionValue,
                "<"  => mv <  rule.ConditionValue,
                "="  => mv == rule.ConditionValue,
                _ => false
            };
            if (passes)
            {
                applied.Add(new() {
                    ["name"] = rule.Name,
                    ["type"] = rule.Type,
                    ["metric_value"] = Math.Round(mv * 100) / 100,
                    ["threshold"] = rule.ConditionValue,
                    ["multiplier"] = rule.MultiplierValue,
                    ["stacking"] = rule.StackingMode,
                });
                matched.Add((rule.MultiplierValue, rule.StackingMode));
            }
        }

        double finalMult = 1.0;
        double additive = 0;
        foreach (var (val, mode) in matched)
        {
            switch (mode)
            {
                case "multiplicative": finalMult *= val; break;
                case "additive":       additive += (val - 1); break;
                case "highest_only":   finalMult = Math.Max(finalMult, val); break;
            }
        }
        finalMult += additive;

        var amount = grossPayout * (finalMult - 1);
        return new MultiplierResult
        {
            Amount = Math.Round(amount * 100) / 100,
            Applied = applied,
            FinalMultiplier = Math.Round(finalMult * 1000) / 1000,
            Metrics = metrics,
        };
    }

    // -----------------------------------------------------------------
    // Step 9 — Apply Penalty
    // -----------------------------------------------------------------
    public static PenaltyResult ApplyPenalty(double currentPayout, List<PenaltyRule> rules, List<Transaction> transactions)
    {
        if (rules is null || rules.Count == 0) return new PenaltyResult();

        var sales = transactions.Where(t => t.TransactionType == "sale").ToList();
        var returns = transactions.Where(t => t.TransactionType == "return").ToList();
        var ts = sales.Sum(t => t.Amount);
        var tr = returns.Sum(t => t.Amount);
        var metrics = new Dictionary<string, double>
        {
            ["return_percent"] = ts > 0 ? (tr / ts) * 100 : 0
        };

        double totalPenalty = 0;
        var triggered = new List<Dictionary<string, object?>>();

        foreach (var rule in rules)
        {
            metrics.TryGetValue(rule.TriggerMetric, out var mv);
            bool passes = rule.TriggerOperator switch
            {
                ">=" => mv >= rule.TriggerValue,
                "<=" => mv <= rule.TriggerValue,
                ">"  => mv >  rule.TriggerValue,
                "<"  => mv <  rule.TriggerValue,
                "="  => mv == rule.TriggerValue,
                _ => false
            };
            if (passes)
            {
                double amt = rule.PenaltyType switch
                {
                    "percentage" => currentPayout * (rule.PenaltyValue / 100),
                    "fixed"      => rule.PenaltyValue,
                    _ => 0
                };
                totalPenalty += amt;
                triggered.Add(new() {
                    ["name"] = rule.Name,
                    ["metric_value"] = Math.Round(mv * 100) / 100,
                    ["threshold"] = rule.TriggerValue,
                    ["penalty_type"] = rule.PenaltyType,
                    ["penalty_value"] = rule.PenaltyValue,
                    ["penalty_amount"] = Math.Round(amt * 100) / 100,
                });
            }
        }

        return new PenaltyResult
        {
            Amount = Math.Round(totalPenalty * 100) / 100,
            Triggered = triggered,
            TotalPenaltyPercent = currentPayout > 0 ? Math.Round((totalPenalty / currentPayout) * 100 * 100) / 100 : 0,
        };
    }

    // -----------------------------------------------------------------
    // Step 10 — Apply Cap
    // -----------------------------------------------------------------
    public static CapResult ApplyCap(double currentPayout, List<CappingRule> rules, Employee employee)
    {
        if (rules is null || rules.Count == 0)
            return new CapResult { Capped = currentPayout };

        double mostRestrictive = currentPayout;
        Dictionary<string, object?>? applied = null;

        foreach (var rule in rules)
        {
            double cap = rule.CapType switch
            {
                "max_per_plan"      => rule.CapValue,
                "percent_of_salary" => employee.BaseSalary * (rule.CapValue / 100),
                "max_per_kpi"       => rule.CapValue,
                _ => double.MaxValue
            };
            if (cap < mostRestrictive)
            {
                mostRestrictive = cap;
                applied = new() { ["cap_type"] = rule.CapType, ["cap_value"] = rule.CapValue, ["calculated_cap"] = cap };
            }
        }

        return new CapResult
        {
            Capped = Math.Round(Math.Min(currentPayout, mostRestrictive) * 100) / 100,
            Adjustment = Math.Round(Math.Max(0, currentPayout - mostRestrictive) * 100) / 100,
            Applied = applied,
        };
    }

    // -----------------------------------------------------------------
    // Step 11 — Store Payout
    // -----------------------------------------------------------------
    public static async Task<string> StorePayoutAsync(
        IDb db, Employee employee, string runId, string planId, string period,
        double gross, double kpiDeduction, double fixedIncentive, double multiplier, double penalty,
        double capAdjustment, double splitAdjustment, double netPayout,
        string eligibilityStatus, string eligibilityDetailsJson, string calculationDetailsJson,
        List<KpiResultRow> kpiResults, CancellationToken ct = default)
    {
        var payoutId = Guid.NewGuid().ToString();
        await db.ExecuteAsync(@"
            INSERT INTO employee_payouts
                (id, run_id, employee_id, plan_id, period,
                 gross_payout, kpi_deduction_amount, fixed_incentive_amount, multiplier_amount,
                 penalty_amount, cap_adjustment, split_adjustment, net_payout,
                 eligibility_status, eligibility_details, calculation_details, approval_status)
            VALUES (@id, @run, @emp, @plan, @period,
                    @gross, @ded, @fixed, @mult, @pen, @capAdj, @splitAdj, @net,
                    @elig, @eligDet::text, @calcDet::text, 'pending')",
            new {
                id = payoutId, run = runId, emp = employee.Id, plan = planId, period,
                gross, ded = kpiDeduction, @fixed = fixedIncentive, mult = multiplier,
                pen = penalty, capAdj = capAdjustment, splitAdj = splitAdjustment, net = netPayout,
                elig = eligibilityStatus, eligDet = eligibilityDetailsJson, calcDet = calculationDetailsJson
            }, ct: ct);

        foreach (var kpi in kpiResults)
        {
            await db.ExecuteAsync(@"
                INSERT INTO kpi_results
                    (id, payout_id, kpi_id, target_value, actual_value, achievement_percent,
                     slab_rate, slab_type, raw_payout, weighted_payout, weight, calculation_details)
                VALUES (@id, @pid, @kid, @t, @a, @p, @sr, @st, @r, @w, @wt, @det::text)",
                new {
                    id = Guid.NewGuid().ToString(), pid = payoutId, kid = kpi.KpiId,
                    t = kpi.TargetValue, a = kpi.ActualValue, p = kpi.AchievementPercent,
                    sr = kpi.SlabRate, st = kpi.SlabType, r = kpi.RawPayout, w = kpi.WeightedPayout,
                    wt = kpi.Weight, det = kpi.CalculationDetails
                }, ct: ct);
        }
        return payoutId;
    }

    // -----------------------------------------------------------------
    // Step 12 — Create Approval
    // -----------------------------------------------------------------
    public static async Task CreateApprovalAsync(IDb db, string payoutId, CancellationToken ct = default)
    {
        await db.ExecuteAsync(
            "UPDATE employee_payouts SET approval_status = 'submitted' WHERE id = @id",
            new { id = payoutId }, ct: ct);
        await db.ExecuteAsync(@"
            INSERT INTO approval_log (id, payout_id, action, acted_by, acted_by_role, comments)
            VALUES (@id, @pid, 'submitted', 'system', 'system', 'Auto-submitted after calculation')",
            new { id = Guid.NewGuid().ToString(), pid = payoutId }, ct: ct);
    }
}
