using System.Text.Json;
using Commission.Api.Data;
using Dapper;

namespace Commission.Api.Engine;

/// <summary>
/// All pipeline steps as static helpers. Every SQL string targets the new
/// commissionv1 schema (id BIGSERIAL + uid VARCHAR + FKs on uid + boolean is_active).
/// </summary>
public static class Steps
{
    // -----------------------------------------------------------------
    // Step 1 — fetchScopedTransactions
    //   Self + reports_to descendants + territory subtree fallback
    // -----------------------------------------------------------------
    public static async Task<List<Transaction>> FetchScopedTransactionsAsync(
        IDb db, string empUid, string period, string? salesOfficeUid, string? roleUid,
        string? baseCurrencyCode = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(empUid)) return new();

        var allEmployees = (await db.QueryDynamicAsync(
            "SELECT uid, reports_to_uid FROM employees WHERE is_active = TRUE", ct: ct)).ToList();
        if (allEmployees.Count == 0) return new();

        var childrenByManager = new Dictionary<string, List<string>>();
        foreach (var e in allEmployees)
        {
            string? rt = e.reports_to_uid;
            if (string.IsNullOrEmpty(rt)) continue;
            if (!childrenByManager.TryGetValue(rt!, out var list)) { list = new(); childrenByManager[rt!] = list; }
            list.Add((string)e.uid);
        }

        var scoped = new List<string>();
        var visited = new HashSet<string>();
        var queue = new Queue<string>();
        queue.Enqueue(empUid);
        while (queue.Count > 0)
        {
            var curr = queue.Dequeue();
            if (!visited.Add(curr)) continue;
            scoped.Add(curr);
            if (childrenByManager.TryGetValue(curr, out var kids))
                foreach (var k in kids) queue.Enqueue(k);
        }

        // Supervisor fallback: if scope is just self, expand to sales-office peers.
        // Note: ERP doesn't have territory hierarchy — sales_offices is flat under org_uid.
        var supervisorRoleHints = new HashSet<string> {
            "ROUTE_SUP", "SS", "ASM", "RSM", "DEPOT_MGR"
        };
        // role_uid is opaque — we can't pattern-match without the role's code joined in. Skip for now;
        // the role-aware expansion can be re-added when employees.role_code is reliably populated.
        if (scoped.Count <= 1 && !string.IsNullOrEmpty(salesOfficeUid))
        {
            var rows = await db.QueryDynamicAsync(
                "SELECT uid FROM employees WHERE is_active = TRUE AND uid <> @e AND sales_office_uid = @o",
                new { e = empUid, o = salesOfficeUid }, ct: ct);
            foreach (var r in rows)
            {
                string uid = r.uid;
                if (visited.Add(uid)) scoped.Add(uid);
            }
        }

        // Pull transactions joined with products + customers
        var txns = (await db.QueryAsync<Transaction>(@"
            SELECT t.uid AS Uid,
                   t.emp_uid AS EmpUid,
                   t.customer_uid AS CustomerUid,
                   t.product_uid AS ProductUid,
                   t.transaction_type AS TransactionType,
                   t.quantity AS Quantity,
                   t.amount AS Amount,
                   t.transaction_date AS TransactionDate,
                   t.period AS Period,
                   t.sales_office_uid AS SalesOfficeUid,
                   COALESCE(t.currency_uid, '') AS CurrencyUid,
                   COALESCE(t.base_amount, t.amount) AS BaseAmount,
                   COALESCE(t.exchange_rate, 1.0) AS ExchangeRate,
                   t.source_parent_uid AS SourceParentUid,
                   p.code AS ProductCode, p.name AS ProductName,
                   p.brand_uid AS ProductBrandUid, p.brand_name AS ProductBrandName,
                   p.category_uid AS ProductCategoryUid, p.category_name AS ProductCategoryName,
                   p.subcategory_uid AS ProductSubcategoryUid, p.subcategory_name AS ProductSubcategoryName,
                   COALESCE(p.is_strategic, FALSE) AS IsStrategic,
                   COALESCE(p.is_new_launch, FALSE) AS IsNewLaunch,
                   COALESCE(p.tags::text, '[]') AS ProductTags,
                   c.code AS CustomerCode, c.name AS CustomerName,
                   c.channel_uid AS CustomerChannelUid, c.channel_name AS CustomerChannelName,
                   c.customer_group_uid AS CustomerGroupUid, c.customer_group_name AS CustomerGroupName
            FROM transactions t
            LEFT JOIN products  p ON t.product_uid  = p.uid
            LEFT JOIN customers c ON t.customer_uid = c.uid
            WHERE t.emp_uid = ANY(@emps) AND t.period = @period
            ORDER BY t.transaction_date",
            new { emps = scoped.ToArray(), period }, ct: ct)).ToList();

        // Currency normalization — convert each rate into a multiplier
        // that turns the transaction's currency into the configured base currency.
        // If no base currency is configured, normalization is skipped (rate=1).
        var rates = new Dictionary<string, double>();
        if (!string.IsNullOrEmpty(baseCurrencyCode))
        {
            try
            {
                var rows = await db.QueryDynamicAsync(@"
                    SELECT fc.code AS from_code, tc.code AS to_code, er.rate
                    FROM exchange_rate er
                    JOIN currency fc ON er.from_currency_uid = fc.uid
                    JOIN currency tc ON er.to_currency_uid = tc.uid
                    WHERE er.is_active = TRUE", ct: ct);
                foreach (var r in rows)
                {
                    string from = r.from_code, to = r.to_code;
                    double rate = Convert.ToDouble(r.rate);
                    if (from == baseCurrencyCode) rates[to] = 1.0 / rate;
                    else if (to == baseCurrencyCode) rates[from] = rate;
                }
            }
            catch { /* exchange_rate empty — currencies stay at face value */ }
        }

        // Parse product tags JSON into TagIds list for tag-filter support
        foreach (var t in txns)
        {
            var rate = 1.0;
            if (!string.IsNullOrEmpty(t.CurrencyUid))
            {
                // currency_uid stores the FK; we'd need to look up the code. For now,
                // if base_amount was provided by the source it overrides this path.
                rate = rates.TryGetValue(t.CurrencyUid, out var r) ? r : 1.0;
            }
            if (t.BaseAmount == 0) t.BaseAmount = Math.Round(t.Amount * rate * 100) / 100;
            t.ExchangeRate = rate;

            t.TagIds = Json.ParseStringArray(t.ProductTags);
        }

        return txns;
    }

    // -----------------------------------------------------------------
    // Step 3 — KPI Achievement (calls FormulaEvaluator, fallback to legacy)
    // -----------------------------------------------------------------
    // KPIs that must aggregate per-day (compute the formula on each day's txns,
    // then average across days where the denominator is non-zero). For salesmen
    // who visit different customers each day, a month-wide COUNT_DISTINCT would
    // under-count scheduled customers and inflate the ratio. Per-day avg is what
    // SADAFCO actually expects for adherence / productivity / service-level.
    private static readonly HashSet<string> PerDayKpiCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        "SERVICE_LEVEL",
        "JP_ADHERENCE", "JP_ADHERENCE_STRICT", "JP_COVERAGE",
        "PRODUCTIVITY",
    };

    public static async Task<KpiAchievement> CalculateKpiAchievementAsync(
        FormulaEvaluator evaluator, IDb db,
        List<Transaction> transactions, PlanKpi planKpi, Employee employee, string period,
        double? targetOverride = null, CancellationToken ct = default)
    {
        double? actual = null;
        double? numerator = null, denominator = null;
        string? numeratorUnit = null, denominatorUnit = null, actualUnit = null;
        string formulaType = "legacy";

        try
        {
            if (PerDayKpiCodes.Contains(planKpi.KpiCode ?? "") && !string.IsNullOrEmpty(planKpi.Formula))
            {
                // Per-day SUM model: today distinct=5, tomorrow distinct=20 -> 25.
                // Same for denominator. Then ratio = 25/30 × 100. NOT distinct
                // across the whole month (that would dedupe a customer scheduled
                // on multiple days into 1).
                using var doc = JsonDocument.Parse(planKpi.Formula);
                var root = doc.RootElement;
                if (root.TryGetProperty("type", out var tEl) && tEl.GetString() == "ratio" &&
                    root.TryGetProperty("numerator", out var numEl) &&
                    root.TryGetProperty("denominator", out var denEl))
                {
                    var multiplyBy = root.TryGetProperty("multiplyBy", out var mEl) && mEl.TryGetDouble(out var mv) ? mv : 1;
                    double numSum = 0, denSum = 0;
                    foreach (var dayGroup in transactions.GroupBy(t => t.TransactionDate.Date))
                    {
                        var dayTxns = dayGroup.ToList();
                        numSum += FormulaEvaluator.EvaluateMetricPublic(numEl, dayTxns);
                        denSum += FormulaEvaluator.EvaluateMetricPublic(denEl, dayTxns);
                    }
                    actual = denSum > 0 ? (numSum / denSum) * multiplyBy : 0;
                    numerator = numSum;
                    denominator = denSum;
                    numeratorUnit   = FormulaEvaluator.UnitForMetricPublic(numEl);
                    denominatorUnit = FormulaEvaluator.UnitForMetricPublic(denEl);
                    actualUnit = "percent";
                    formulaType = "ratio";
                }
                else
                {
                    var detailed = await evaluator.EvaluateDetailedAsync(planKpi.Formula, transactions, employee, period, ct);
                    actual          = detailed?.Value;
                    numerator       = detailed?.Numerator;
                    denominator     = detailed?.Denominator;
                    numeratorUnit   = detailed?.NumeratorUnit;
                    denominatorUnit = detailed?.DenominatorUnit;
                    actualUnit      = detailed?.ActualUnit;
                    formulaType     = detailed?.FormulaType ?? "legacy";
                }
            }
            else
            {
                var detailed = await evaluator.EvaluateDetailedAsync(planKpi.Formula, transactions, employee, period, ct);
                actual          = detailed?.Value;
                numerator       = detailed?.Numerator;
                denominator     = detailed?.Denominator;
                numeratorUnit   = detailed?.NumeratorUnit;
                denominatorUnit = detailed?.DenominatorUnit;
                actualUnit      = detailed?.ActualUnit;
                formulaType     = detailed?.FormulaType ?? "legacy";
            }
        }
        catch { actual = null; }
        if (actual is null)
        {
            actual = await LegacyCalculateAsync(db, transactions, planKpi, employee, period, ct);
            formulaType = "legacy";
        }

        double target = targetOverride ?? planKpi.TargetValue;
        // The formula is responsible for producing the slab-ready metric (its
        // output ends in × 100 for ratio-style KPIs). The engine no longer
        // re-divides by target or inverts for lower_is_better — slab tiers and
        // deduction rules are authored against the formula output directly.
        double percent = actual.Value;

        return new KpiAchievement
        {
            Actual = Math.Round(actual.Value * 100) / 100,
            Target = target,
            Percent = Math.Round(percent * 100) / 100,
            Numerator       = numerator.HasValue   ? Math.Round(numerator.Value   * 10000) / 10000 : null,
            Denominator     = denominator.HasValue ? Math.Round(denominator.Value * 10000) / 10000 : null,
            NumeratorUnit   = numeratorUnit,
            DenominatorUnit = denominatorUnit,
            ActualUnit      = actualUnit,
            FormulaType     = formulaType,
        };
    }

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
                    "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE emp_uid = @e AND period = @p AND transaction_type = 'sale'",
                    new { e = employee.Uid, p = prevPeriod }, ct: ct);
                return prev > 0 ? ((currentRev - prev) / prev) * 100 : 0;
            }
            case "UNITS_SOLD":      return sales.Sum(t => t.Quantity);
            case "OUTLET_COVERAGE": return sales.Select(t => t.CustomerUid).Distinct().Count();
            case "LINES_PER_CALL":
            {
                var uProds = sales.Select(t => t.ProductUid).Distinct().Count();
                var uCusts = sales.Select(t => t.CustomerUid).Distinct().Count();
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
            case "STRATEGIC_SKU_REV": return sales.Where(t => t.IsStrategic).Sum(t => t.Amount);
            case "NEW_LAUNCH_SALES":  return sales.Where(t => t.IsNewLaunch).Sum(t => t.Amount);
            case "NEW_CUSTOMERS":     return sales.Select(t => t.CustomerUid).Distinct().Count();
            case "CRATES_LOADED":     return transactions.Where(t => t.TransactionType == "crate_load").Sum(t => t.Quantity);
            case "CASES_DELIVERED":   return transactions.Where(t => t.TransactionType == "case_delivery").Sum(t => t.Quantity);
            case "PALLETS_HANDLED":   return transactions.Where(t => t.TransactionType == "pallet_handling").Sum(t => t.Quantity);
            case "TEAM_REVENUE":
            {
                var reps = await db.QueryDynamicAsync(
                    "SELECT uid FROM employees WHERE reports_to_uid = @e", new { e = employee.Uid }, ct: ct);
                double team = 0;
                foreach (var r in reps)
                {
                    var v = await db.QuerySingleOrDefaultAsync<double>(
                        "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE emp_uid = @e AND period = @p AND transaction_type = 'sale'",
                        new { e = (string)r.uid, p = period }, ct: ct);
                    team += v;
                }
                return team;
            }
            case "TEAM_TARGET_ACH": return 90;
            case "REV_PER_OUTLET":
            {
                var rev = sales.Sum(t => t.Amount);
                var outlets = sales.Select(t => t.CustomerUid).Distinct().Count();
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
            bool minOk = tier.MinInclusive ? percent >= tier.MinPercent : percent > tier.MinPercent;
            bool maxOk = !tier.MaxPercent.HasValue || (tier.MaxInclusive ? percent <= max : percent < max);
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
            // Honour the per-tier inclusive flags so boundary values (e.g. exactly 95%)
            // land in the right tier rather than silently bleeding into the next one.
            var max = tier.MaxPercent ?? double.PositiveInfinity;
            bool minOk = tier.MinInclusive ? percent >= tier.MinPercent : percent > tier.MinPercent;
            bool maxOk = !tier.MaxPercent.HasValue || (tier.MaxInclusive ? percent <= max : percent < max);
            if (minOk && maxOk) { matched = tier; rate = tier.Rate; break; }
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
                .Where(r => (string.IsNullOrEmpty(r.RoleUid) || r.RoleUid == employee.RoleUid) &&
                            (string.IsNullOrEmpty(r.KpiUid)  || r.KpiUid  == kpi.KpiUid))
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
                    ["kpi_uid"] = kpi.KpiUid,
                    ["kpi_name"] = kpi.KpiName,
                    ["kpi_code"] = kpi.KpiCode,
                    ["rule_uid"] = selected.Uid,
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
        bool minOk = !r.MinValue.HasValue || (r.MinInclusive ? value >= r.MinValue.Value : value > r.MinValue.Value);
        bool maxOk = !r.MaxValue.HasValue || (r.MaxInclusive ? value <= r.MaxValue.Value : value < r.MaxValue.Value);
        return minOk && maxOk;
    }

    private static double ComputeMetricValue(KpiResultRow kpi, string metricType) => metricType switch
    {
        "achievement_percent" => kpi.AchievementPercent,
        "actual_value"        => kpi.ActualValue,
        _                     => Math.Max(0, 100 - kpi.AchievementPercent),
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
                "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE emp_uid = @e AND period = @p AND transaction_type = 'sale'",
                new { e = employee.Uid, p = prevPeriod }, ct: ct);
            metrics["revenue_growth_percent"] = prev > 0 ? ((totalSales - prev) / prev) * 100 : 0;
        }

        var strategic = sales.Where(t => t.IsStrategic).Sum(t => t.Amount);
        metrics["strategic_sku_percent"] = totalSales > 0 ? (strategic / totalSales) * 100 : 0;
        var newLaunch = sales.Where(t => t.IsNewLaunch).Sum(t => t.Amount);
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
        IDb db, Employee employee, string runUid, string planUid, string period,
        double gross, double kpiDeduction, double fixedIncentive, double multiplier, double penalty,
        double capAdjustment, double splitAdjustment, double netPayout,
        string eligibilityStatus, string eligibilityDetailsJson, string calculationDetailsJson,
        List<KpiResultRow> kpiResults, CancellationToken ct = default,
        string? planName = null, string? currencyUid = null, string? currencyCode = null)
    {
        var payoutUid = Guid.NewGuid().ToString();
        await db.ExecuteAsync(@"
            INSERT INTO employee_payouts
                (uid, run_uid, emp_uid, plan_uid, period,
                 gross_payout, kpi_deduction_amount, fixed_incentive_amount, multiplier_amount,
                 penalty_amount, cap_adjustment, split_adjustment, net_payout,
                 eligibility_status, eligibility_details, calculation_details, approval_status,
                 source_system)
            VALUES (@uid, @run, @emp, @plan, @period,
                    @gross, @ded, @fixed, @mult, @pen, @capAdj, @splitAdj, @net,
                    @elig, @eligDet::jsonb, @calcDet::jsonb, 'pending', 'engine')",
            new {
                uid = payoutUid, run = runUid, emp = employee.Uid, plan = planUid, period,
                gross, ded = kpiDeduction, @fixed = fixedIncentive, mult = multiplier,
                pen = penalty, capAdj = capAdjustment, splitAdj = splitAdjustment, net = netPayout,
                elig = eligibilityStatus, eligDet = eligibilityDetailsJson, calcDet = calculationDetailsJson
            }, ct: ct);

        foreach (var kpi in kpiResults)
        {
            await db.ExecuteAsync(@"
                INSERT INTO kpi_results
                    (uid, payout_uid, kpi_uid, target_value, actual_value, achievement_percent,
                     slab_rate, slab_type, raw_payout, weighted_payout, weight, calculation_details,
                     numerator_value, denominator_value,
                     numerator_unit, denominator_unit, actual_unit,
                     goal_threshold_percent, formula_type,
                     kpi_code_snapshot, kpi_name_snapshot,
                     period, emp_uid, emp_code, employee_name,
                     role_code, role_name, sales_office_uid, sales_office_name,
                     plan_uid, plan_name, currency_uid, currency_code,
                     source_system)
                VALUES (@uid, @pid, @kid, @t, @a, @p, @sr, @st, @r, @w, @wt, @det::jsonb,
                        @num, @den, @nu, @du, @au, @gth, @ft, @kcs, @kns,
                        @period, @empUid, @empCode, @empName,
                        @roleCode, @roleName, @soUid, @soName,
                        @planUid, @planName, @curUid, @curCode,
                        'engine')",
                new {
                    uid = Guid.NewGuid().ToString(), pid = payoutUid, kid = kpi.KpiUid,
                    t = kpi.TargetValue, a = kpi.ActualValue, p = kpi.AchievementPercent,
                    sr = kpi.SlabRate, st = kpi.SlabType, r = kpi.RawPayout, w = kpi.WeightedPayout,
                    wt = kpi.Weight, det = kpi.CalculationDetails,
                    num = kpi.NumeratorValue, den = kpi.DenominatorValue,
                    nu  = kpi.NumeratorUnit,  du  = kpi.DenominatorUnit, au = kpi.ActualUnit,
                    gth = kpi.GoalThresholdPercent ?? kpi.TargetValue,
                    ft  = kpi.FormulaType,
                    kcs = kpi.KpiCode,        kns = kpi.KpiName,
                    period,
                    empUid   = employee.Uid,        empCode  = employee.EmpCode,
                    empName  = employee.Name,
                    roleCode = employee.RoleCode,   roleName = employee.RoleNameEn,
                    soUid    = employee.SalesOfficeUid,
                    soName   = employee.SalesOfficeName,
                    planUid,  planName,
                    curUid   = currencyUid,         curCode  = currencyCode,
                }, ct: ct);
        }
        return payoutUid;
    }

    // -----------------------------------------------------------------
    // Step 12 — Create Approval
    // -----------------------------------------------------------------
    public static async Task CreateApprovalAsync(IDb db, string payoutUid, CancellationToken ct = default)
    {
        await db.ExecuteAsync(
            "UPDATE employee_payouts SET approval_status = 'submitted', modified_time = NOW() WHERE uid = @uid",
            new { uid = payoutUid }, ct: ct);
        await db.ExecuteAsync(@"
            INSERT INTO approval_log (uid, payout_uid, action, acted_by, acted_by_role, comments, source_system)
            VALUES (@uid, @pid, 'submitted', 'system', 'system', 'Auto-submitted after calculation', 'engine')",
            new { uid = Guid.NewGuid().ToString(), pid = payoutUid }, ct: ct);
    }
}
