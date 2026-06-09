using System.Text.Json;
using Commission.Api.Data;
using Dapper;

namespace Commission.Api.Engine;

/// <summary>
/// Result of EvaluateDetailedAsync — the scalar formula output plus the inputs
/// it consumed (numerator, denominator, units). Persisted onto kpi_results so
/// every row is self-documenting and inspection queries don't need joins to
/// transactions to reconstruct what was measured.
/// </summary>
public class FormulaEvaluationResult
{
    public double? Value { get; set; }
    public double? Numerator { get; set; }
    public double? Denominator { get; set; }
    public string? NumeratorUnit { get; set; }
    public string? DenominatorUnit { get; set; }
    public string? ActualUnit { get; set; }
    public string FormulaType { get; set; } = "legacy";
}

/// <summary>
/// Reads structured JSON formulas from kpi_definitions.formula (now JSONB)
/// and evaluates them against a transaction list, falling back to direct DB queries
/// for growth (previous-period) and team (descendants) types.
/// </summary>
public class FormulaEvaluator
{
    private static readonly HashSet<string> ValidFields = new() {
        "amount", "quantity", "customer_uid", "product_uid", "base_amount", "net_amount"
    };
    private static readonly HashSet<string> ValidFilterFields = new() {
        "is_strategic", "is_new_launch",
        "product_brand", "product_category", "product_subcategory", "product_sku",
        "customer_channel", "customer_group",
        "transaction_type", "tag"
    };
    private static readonly HashSet<string> ValidAggregations = new() {
        "SUM", "COUNT_DISTINCT", "AVG", "COUNT"
    };
    private static readonly HashSet<string> ValidTxTypes = new() {
        "sale", "return", "bad_return", "collection", "target",
        "crate_load", "case_delivery", "pallet_handling",
        "visit", "visit_outside_schedule", "planned_visit", "scheduled_visit",
        "overdue", "outstanding",
        "zero_sales_customer", "assigned_customer",
        "ir_audit", "event",
        "all"
    };

    private readonly IDb _db;
    public FormulaEvaluator(IDb db) { _db = db; }

    public async Task<double?> EvaluateAsync(
        string formulaJson,
        List<Transaction> transactions,
        Employee employee,
        string period,
        CancellationToken ct = default)
    {
        // Thin back-compat wrapper. New code should call EvaluateDetailedAsync
        // to get numerator/denominator/units alongside the scalar value.
        var detailed = await EvaluateDetailedAsync(formulaJson, transactions, employee, period, ct);
        return detailed?.Value;
    }

    /// <summary>
    /// Evaluate a formula and return the scalar result PLUS the inputs the
    /// formula consumed (numerator, denominator, units). Callers persist these
    /// onto kpi_results so each row tells the full story: "what they did /
    /// what they had to hit / achievement / payout" — no joins required.
    ///
    /// Returns null only when the formula JSON is unparseable. For valid
    /// formulas where a particular field is irrelevant (e.g., denominator
    /// for a simple SUM), that field on the result is null.
    /// </summary>
    public async Task<FormulaEvaluationResult?> EvaluateDetailedAsync(
        string formulaJson,
        List<Transaction> transactions,
        Employee employee,
        string period,
        CancellationToken ct = default)
    {
        var formula = ParseFormula(formulaJson);
        if (formula is null) return null;

        var type = formula.Value.TryGetProperty("type", out var t) ? t.GetString() : null;
        var result = new FormulaEvaluationResult { FormulaType = type ?? "unknown" };

        switch (type)
        {
            case "simple":
            {
                var v = EvaluateSimple(formula.Value, transactions);
                result.Value = v;
                result.Numerator = v;
                result.NumeratorUnit = UnitForMetric(formula.Value);
                result.ActualUnit = result.NumeratorUnit;
                break;
            }
            case "ratio":
            {
                var num = formula.Value.TryGetProperty("numerator", out var n)   ? EvaluateMetric(n, transactions) : 0;
                var den = formula.Value.TryGetProperty("denominator", out var d) ? EvaluateMetric(d, transactions) : 0;
                var multiplyBy = formula.Value.TryGetProperty("multiplyBy", out var m) && m.TryGetDouble(out var mv) ? mv : 1;
                result.Value = den == 0 ? 0 : (num / den) * multiplyBy;
                result.Numerator = num;
                result.Denominator = den;
                result.NumeratorUnit   = formula.Value.TryGetProperty("numerator", out var nEl)   ? UnitForMetric(nEl) : null;
                result.DenominatorUnit = formula.Value.TryGetProperty("denominator", out var dEl) ? UnitForMetric(dEl) : null;
                // ratio output is a percentage when multiplyBy is 100 (the SADAFCO convention);
                // otherwise it's a unitless ratio — still report as 'percent' since slab tiers compare against it.
                result.ActualUnit = "percent";
                break;
            }
            case "growth":
            {
                var v = await EvaluateGrowthAsync(formula.Value, transactions, employee, period, ct);
                result.Value = v;
                // Growth = ((current - prev) / prev) * 100. The numerator we surface is
                // the current period's base metric; the denominator is the prior baseline.
                if (formula.Value.TryGetProperty("baseMetric", out var baseMetric))
                {
                    result.Numerator = EvaluateMetric(baseMetric, transactions);
                    result.NumeratorUnit = UnitForMetric(baseMetric);
                    result.DenominatorUnit = result.NumeratorUnit;
                    // Denominator (prior-period baseline) is computed inside EvaluateGrowthAsync
                    // and not surfaced here; back-derive it from current and percent.
                    if (v != 0 && result.Numerator is double curr)
                    {
                        // pct = (curr - prev)/prev * 100 -> prev = curr / (1 + pct/100)
                        var denom = curr / (1 + v / 100.0);
                        result.Denominator = Math.Abs(denom) < 1e-9 ? null : denom;
                    }
                }
                result.ActualUnit = "percent";
                break;
            }
            case "team":
            {
                var v = await EvaluateTeamAsync(formula.Value, employee, period, ct);
                result.Value = v;
                result.Numerator = v;
                if (formula.Value.TryGetProperty("baseMetric", out var baseMetric))
                {
                    result.NumeratorUnit = UnitForMetric(baseMetric);
                }
                result.ActualUnit = result.NumeratorUnit;
                break;
            }
            case "static":
            {
                var v = formula.Value.TryGetProperty("defaultValue", out var d) && d.TryGetDouble(out var dv) ? dv : 0;
                result.Value = v;
                result.ActualUnit = "number";
                break;
            }
            default:
                return null;
        }

        return result;
    }

    // Public wrapper so Steps.cs can derive units for the per-day SUM branch
    // (which evaluates numerator/denominator manually rather than via EvaluateDetailedAsync).
    public static string UnitForMetricPublic(JsonElement metric) => UnitForMetric(metric);

    // Derive a unit label for a metric subtree based on its aggregation + field.
    // SUM(amount)         → 'AED'    (currency)
    // SUM(quantity)       → 'count'
    // COUNT/COUNT_DISTINCT → 'count'
    // AVG(amount)         → 'AED'
    // Caller decides whether to override (e.g. ratio output is always 'percent').
    private static string UnitForMetric(JsonElement metric)
    {
        if (metric.ValueKind != JsonValueKind.Object) return "number";
        var agg = metric.TryGetProperty("aggregation", out var a) ? a.GetString() ?? "SUM" : "SUM";
        var field = metric.TryGetProperty("field", out var f) ? f.GetString() ?? "amount" : "amount";
        if (agg == "COUNT" || agg == "COUNT_DISTINCT") return "count";
        return field switch
        {
            "amount" or "base_amount" or "net_amount" => "AED",
            "quantity" => "count",
            _ => "number",
        };
    }

    private static JsonElement? ParseFormula(string? formulaJson)
    {
        if (string.IsNullOrWhiteSpace(formulaJson)) return null;
        try
        {
            var doc = JsonDocument.Parse(formulaJson);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("type", out _))
                return doc.RootElement.Clone();
            return null;
        }
        catch { return null; }
    }

    // ----- Simple / Ratio (in-memory) -----

    private static double EvaluateSimple(JsonElement formula, List<Transaction> txns)
        => EvaluateMetric(formula, txns);

    private static double EvaluateRatio(JsonElement formula, List<Transaction> txns)
    {
        var num = formula.TryGetProperty("numerator", out var n) ? EvaluateMetric(n, txns) : 0;
        var den = formula.TryGetProperty("denominator", out var d) ? EvaluateMetric(d, txns) : 0;
        if (den == 0) return 0;
        var multiplyBy = formula.TryGetProperty("multiplyBy", out var m) && m.TryGetDouble(out var mv) ? mv : 1;
        return (num / den) * multiplyBy;
    }

    // Public so Steps.cs can evaluate numerator / denominator on a per-day
    // subset of txns for KPIs like SERVICE_LEVEL where SUM-of-daily-distinct
    // matters (a customer scheduled on 4 days counts as 4 in the denominator).
    public static double EvaluateMetricPublic(JsonElement metric, List<Transaction> txns)
        => EvaluateMetric(metric, txns);

    private static double EvaluateMetric(JsonElement metric, List<Transaction> txns)
    {
        var filtered = FilterTransactions(metric, txns);
        var aggregation = metric.TryGetProperty("aggregation", out var a) ? a.GetString() ?? "SUM" : "SUM";
        var field = metric.TryGetProperty("field", out var f) ? f.GetString() ?? "amount" : "amount";

        // Net-sales pattern: when the user explicitly selects BOTH `sale` and
        // `return` (or `bad_return`) in transactionTypes, treat returns as
        // negative so SUM gives net sales = sale - return. Lets the UI keep
        // showing "sale + return" while the engine quietly does sale - return.
        if (aggregation == "SUM" &&
            metric.TryGetProperty("transactionTypes", out var tts) &&
            tts.ValueKind == JsonValueKind.Array)
        {
            var typeSet = new HashSet<string>();
            foreach (var item in tts.EnumerateArray())
            {
                var s = item.GetString();
                if (!string.IsNullOrEmpty(s)) typeSet.Add(s);
            }
            bool hasSale   = typeSet.Contains("sale");
            bool hasReturn = typeSet.Contains("return") || typeSet.Contains("bad_return");
            if (hasSale && hasReturn)
            {
                return filtered.Sum(t =>
                {
                    var v = GetField(t, field);
                    return (t.TransactionType == "return" || t.TransactionType == "bad_return") ? -v : v;
                });
            }
        }

        return Aggregate(filtered, aggregation, field);
    }

    private static List<Transaction> FilterTransactions(JsonElement metric, List<Transaction> txns)
    {
        IEnumerable<Transaction> filtered = txns;

        // Multi-type support: prefer `transactionTypes` (array) when present so
        // a single metric can aggregate across e.g. ['sale','return']. Falls back
        // to the legacy single `transactionType` field.
        if (metric.TryGetProperty("transactionTypes", out var tts) && tts.ValueKind == JsonValueKind.Array)
        {
            var typeSet = new HashSet<string>();
            foreach (var item in tts.EnumerateArray())
            {
                var s = item.GetString();
                if (!string.IsNullOrEmpty(s)) typeSet.Add(s);
            }
            if (typeSet.Count > 0 && !typeSet.Contains("all"))
                filtered = filtered.Where(t => typeSet.Contains(t.TransactionType));
        }
        else if (metric.TryGetProperty("transactionType", out var tt))
        {
            var txType = tt.GetString();
            if (!string.IsNullOrEmpty(txType) && txType != "all")
            {
                // Quiet superset: 'return' covers both 'return' and 'bad_return'
                // so KPI formulas can be written naturally as `return / sale` etc.
                // and Bad Returns ratios compute against total returns.
                if (txType == "return")
                    filtered = filtered.Where(t => t.TransactionType == "return" || t.TransactionType == "bad_return");
                else
                    filtered = filtered.Where(t => t.TransactionType == txType);
            }
        }

        if (metric.TryGetProperty("filters", out var filters) && filters.ValueKind == JsonValueKind.Array)
        {
            foreach (var f in filters.EnumerateArray())
            {
                var field = f.TryGetProperty("field", out var fld) ? fld.GetString() : null;
                if (string.IsNullOrEmpty(field) || !ValidFilterFields.Contains(field)) continue;
                var op = f.TryGetProperty("operator", out var o) ? o.GetString() ?? "=" : "=";

                JsonElement? value = f.TryGetProperty("value", out var v) ? v : (JsonElement?)null;

                if (field == "tag")
                {
                    var tagVals = ExtractValueList(value);
                    filtered = filtered.Where(t =>
                    {
                        var tags = t.TagIds ?? new List<string>();
                        return op == "not_in"
                            ? !tagVals.Any(v0 => tags.Contains(v0))
                            : tagVals.Any(v0 => tags.Contains(v0));
                    });
                    continue;
                }

                filtered = filtered.Where(t => MatchesFilter(t, field, op, value));
            }
        }

        return filtered.ToList();
    }

    private static bool MatchesFilter(Transaction t, string field, string op, JsonElement? value)
    {
        object? val = field switch
        {
            "product_brand"       => t.ProductBrandName       ?? t.ProductBrandUid,
            "product_category"    => t.ProductCategoryName    ?? t.ProductCategoryUid,
            "product_subcategory" => t.ProductSubcategoryName ?? t.ProductSubcategoryUid,
            "product_sku"         => t.ProductCode,                                // SKU = product code
            "is_strategic"        => t.IsStrategic,
            "is_new_launch"       => t.IsNewLaunch,
            "customer_channel"    => t.CustomerChannelName ?? t.CustomerChannelUid,
            "customer_group"      => t.CustomerGroupName   ?? t.CustomerGroupUid,
            "transaction_type"    => t.TransactionType,
            _ => null
        };

        return op switch
        {
            "=" or "==" => CompareEqual(val, value),
            "!="        => !CompareEqual(val, value),
            "in"        => ExtractValueList(value).Any(v => CompareEqual(val, v)),
            "not_in"    => !ExtractValueList(value).Any(v => CompareEqual(val, v)),
            _ => true
        };
    }

    private static bool CompareEqual(object? actual, JsonElement? value)
    {
        if (value is null) return actual is null;
        if (value.Value.ValueKind == JsonValueKind.Null) return actual is null;
        var s = JsonValueToString(value.Value);
        return string.Equals(actual?.ToString(), s, StringComparison.Ordinal) ||
               (double.TryParse(actual?.ToString(), out var a) &&
                double.TryParse(s, out var b) && a == b);
    }

    private static bool CompareEqual(object? actual, string value)
        => string.Equals(actual?.ToString(), value, StringComparison.Ordinal) ||
           (double.TryParse(actual?.ToString(), out var a) &&
            double.TryParse(value, out var b) && a == b);

    private static List<string> ExtractValueList(JsonElement? value)
    {
        if (value is null) return new List<string>();
        var v = value.Value;
        if (v.ValueKind == JsonValueKind.Array)
            return v.EnumerateArray().Select(JsonValueToString).ToList();
        return new List<string> { JsonValueToString(v) };
    }

    private static string JsonValueToString(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString() ?? "",
        JsonValueKind.Number => e.GetRawText(),
        JsonValueKind.True   => "true",
        JsonValueKind.False  => "false",
        JsonValueKind.Null   => "",
        _                    => e.ToString()
    };

    private static double Aggregate(List<Transaction> txns, string aggregation, string field)
    {
        if (!ValidFields.Contains(field) && aggregation != "COUNT") return 0;

        return aggregation switch
        {
            "SUM" => txns.Sum(t => GetField(t, field)),
            "COUNT" => txns.Count,
            "COUNT_DISTINCT" => txns.Select(t => GetFieldStr(t, field)).Distinct().Count(),
            "AVG" => txns.Count == 0 ? 0 : txns.Sum(t => GetField(t, field)) / txns.Count,
            _ => 0
        };
    }

    private static double GetField(Transaction t, string field) => field switch
    {
        "amount" => t.Amount,
        "quantity" => t.Quantity,
        "base_amount" => t.BaseAmount,
        "net_amount" => t.Amount,        // net_amount field on transactions row; in-memory we use Amount
        _ => 0
    };

    private static string GetFieldStr(Transaction t, string field) => field switch
    {
        "customer_uid" => t.CustomerUid ?? "",
        "product_uid"  => t.ProductUid ?? "",
        "amount" => t.Amount.ToString("R"),
        "quantity" => t.Quantity.ToString("R"),
        "base_amount" => t.BaseAmount.ToString("R"),
        _ => ""
    };

    // ----- Growth / Team (hit DB for prev-period or descendants) -----

    private async Task<double> EvaluateGrowthAsync(
        JsonElement formula, List<Transaction> currentTxns, Employee employee, string period, CancellationToken ct)
    {
        if (!formula.TryGetProperty("baseMetric", out var baseMetric)) return 0;
        var current = EvaluateMetric(baseMetric, currentTxns);

        var compareWith = formula.TryGetProperty("compareWith", out var cw) ? cw.GetString() : "previous_year";
        var parts = period.Split('-');
        if (parts.Length != 2 || !int.TryParse(parts[0], out var year) || !int.TryParse(parts[1], out var month))
            return 0;

        string prevPeriod;
        if (compareWith == "previous_month")
        {
            var pm = month == 1 ? 12 : month - 1;
            var py = month == 1 ? year - 1 : year;
            prevPeriod = $"{py:D4}-{pm:D2}";
        }
        else
        {
            prevPeriod = $"{year - 1:D4}-{month:D2}";
        }

        var prev = await QueryMetricAsync(baseMetric, employee.Uid, prevPeriod, ct);
        if (prev == 0) return 0;
        return ((current - prev) / prev) * 100;
    }

    private async Task<double> EvaluateTeamAsync(
        JsonElement formula, Employee employee, string period, CancellationToken ct)
    {
        if (!formula.TryGetProperty("baseMetric", out var baseMetric)) return 0;
        var reports = await _db.QueryAsync<dynamic>(
            "SELECT uid FROM employees WHERE reports_to_uid = @id", new { id = employee.Uid }, ct: ct);
        var values = new List<double>();
        foreach (var rep in reports)
        {
            var v = await QueryMetricAsync(baseMetric, (string)rep.uid, period, ct);
            values.Add(v);
        }
        var teamAgg = formula.TryGetProperty("teamAggregation", out var ta) ? ta.GetString() ?? "SUM" : "SUM";
        return teamAgg switch
        {
            "SUM" => values.Sum(),
            "AVG" => values.Count > 0 ? values.Average() : 0,
            "COUNT" => values.Count,
            _ => values.Sum()
        };
    }

    private async Task<double> QueryMetricAsync(JsonElement metric, string empUid, string period, CancellationToken ct)
    {
        // Multi-type support — mirror of the in-memory path. If `transactionTypes`
        // is an array, use IN(...); otherwise fall back to single `transactionType`.
        var typeList = new List<string>();
        if (metric.TryGetProperty("transactionTypes", out var tts) && tts.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in tts.EnumerateArray())
            {
                var s = item.GetString();
                if (!string.IsNullOrEmpty(s) && ValidTxTypes.Contains(s)) typeList.Add(s);
            }
        }
        var txType = metric.TryGetProperty("transactionType", out var tt) ? tt.GetString() ?? "sale" : "sale";
        if (!ValidTxTypes.Contains(txType)) txType = "sale";
        var field = metric.TryGetProperty("field", out var f) ? f.GetString() ?? "amount" : "amount";
        if (!ValidFields.Contains(field)) field = "amount";
        var agg = metric.TryGetProperty("aggregation", out var a) ? a.GetString() ?? "SUM" : "SUM";
        if (!ValidAggregations.Contains(agg)) agg = "SUM";

        var paramDict = new Dictionary<string, object>
        {
            ["empUid"] = empUid,
            ["period"] = period,
        };

        bool needsProductJoin = false;
        bool needsCustomerJoin = false;
        var filterClauses = new List<string>();
        int pIdx = 0;

        if (metric.TryGetProperty("filters", out var filters) && filters.ValueKind == JsonValueKind.Array)
        {
            foreach (var fl in filters.EnumerateArray())
            {
                var ff = fl.TryGetProperty("field", out var fld) ? fld.GetString() : null;
                if (string.IsNullOrEmpty(ff) || !ValidFilterFields.Contains(ff)) continue;
                if (ff is "is_strategic" or "is_new_launch" or "product_brand"
                       or "product_category" or "product_subcategory" or "product_sku") needsProductJoin = true;
                if (ff is "customer_channel" or "customer_group") needsCustomerJoin = true;

                var col = MapFilterFieldToColumn(ff);
                var op = fl.TryGetProperty("operator", out var o) ? o.GetString() ?? "=" : "=";
                var value = fl.TryGetProperty("value", out var v) ? v : (JsonElement?)null;

                if (op == "=" || op == "!=")
                {
                    var pn = $"flt{++pIdx}";
                    paramDict[pn] = JsonElementToObject(value);
                    filterClauses.Add($" AND {col} {(op == "!=" ? "!=" : "=")} @{pn}");
                }
                else if (op == "in" || op == "not_in")
                {
                    var list = ExtractValueList(value);
                    if (list.Count == 0) continue;
                    var pnames = new List<string>();
                    foreach (var item in list)
                    {
                        var pn = $"flt{++pIdx}";
                        paramDict[pn] = item;
                        pnames.Add($"@{pn}");
                    }
                    filterClauses.Add($" AND {col} {(op == "not_in" ? "NOT IN" : "IN")} ({string.Join(",", pnames)})");
                }
            }
        }

        var joins = "";
        if (needsProductJoin)  joins += " LEFT JOIN products  p ON t.product_uid  = p.uid";
        if (needsCustomerJoin) joins += " LEFT JOIN customers c ON t.customer_uid = c.uid";

        string typeClause;
        if (typeList.Count > 0)
        {
            // If 'return' is among the explicit types, also include 'bad_return'.
            if (typeList.Contains("return") && !typeList.Contains("bad_return"))
                typeList.Add("bad_return");
            var quoted = string.Join(",", typeList.Select(s => $"'{s.Replace("'", "''")}'"));
            typeClause = $" AND t.transaction_type IN ({quoted})";
        }
        else if (txType == "return")
            typeClause = " AND t.transaction_type IN ('return','bad_return')";
        else
            typeClause = txType != "all" ? $" AND t.transaction_type = '{txType}'" : "";

        // Net-sales pattern (same logic as in-memory path): when both 'sale'
        // and 'return'/'bad_return' are present in transactionTypes, sum with
        // returns negated so SUM = sale - return.
        bool isNetSales = agg == "SUM"
            && typeList.Contains("sale")
            && (typeList.Contains("return") || typeList.Contains("bad_return"));

        string aggExpr = agg switch
        {
            "SUM" when isNetSales =>
                $"COALESCE(SUM(CASE WHEN t.transaction_type IN ('return','bad_return') THEN -t.{field} ELSE t.{field} END), 0)",
            "SUM" => $"COALESCE(SUM(t.{field}), 0)",
            "COUNT" => "COUNT(*)",
            "COUNT_DISTINCT" => $"COUNT(DISTINCT t.{field})",
            "AVG" => $"COALESCE(AVG(t.{field}), 0)",
            _ => $"COALESCE(SUM(t.{field}), 0)"
        };

        var sql = $"SELECT {aggExpr} AS val FROM transactions t{joins} " +
                  $"WHERE t.emp_uid = @empUid AND t.period = @period{typeClause}{string.Join("", filterClauses)}";

        var row = await _db.QuerySingleOrDefaultAsync<dynamic>(sql, paramDict, ct: ct);
        if (row is null) return 0;
        return Convert.ToDouble(row.val ?? 0);
    }

    private static object JsonElementToObject(JsonElement? e) => e?.ValueKind switch
    {
        JsonValueKind.String => e.Value.GetString() ?? "",
        JsonValueKind.Number => e.Value.TryGetInt64(out var i) ? i : (object)e.Value.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => DBNull.Value,
        _ => e?.ToString() ?? ""
    };

    public static string MapFilterFieldToColumn(string field) => field switch
    {
        "is_strategic"        => "p.is_strategic",
        "is_new_launch"       => "p.is_new_launch",
        "product_brand"       => "p.brand_name",              // flattened denorm
        "product_category"    => "p.category_name",           // flattened denorm
        "product_subcategory" => "p.subcategory_name",        // flattened denorm
        "product_sku"         => "p.code",                    // SKU = product code
        "customer_channel"    => "c.channel_name",            // flattened denorm
        "customer_group"      => "c.customer_group_name",     // flattened denorm
        "transaction_type"    => "t.transaction_type",
        _ => $"t.{field}"
    };

    // ----- formulaToText (used by the UI for previews) -----
    public static string FormulaToText(string? formulaJson)
    {
        var elem = ParseFormula(formulaJson);
        if (elem is null) return formulaJson ?? "";
        var type = elem.Value.TryGetProperty("type", out var t) ? t.GetString() : null;
        return type switch
        {
            "simple" => MetricToText(elem.Value),
            "ratio"  => $"({MetricToText(GetProp(elem.Value, "numerator"))} / {MetricToText(GetProp(elem.Value, "denominator"))})" +
                        ((elem.Value.TryGetProperty("multiplyBy", out var m) && m.TryGetDouble(out var mv) && mv != 1) ? $" × {mv}" : ""),
            "growth" => $"Growth of {MetricToText(GetProp(elem.Value, "baseMetric"))} vs {(elem.Value.TryGetProperty("compareWith", out var cw) ? (cw.GetString() ?? "previous_year").Replace("_", " ") : "previous year")}",
            "team"   => $"{(elem.Value.TryGetProperty("teamAggregation", out var ta) ? ta.GetString() : "SUM")} of team's {MetricToText(GetProp(elem.Value, "baseMetric"))}",
            "static" => $"Static: {(elem.Value.TryGetProperty("defaultValue", out var d) ? d.GetRawText() : "0")}",
            _ => formulaJson ?? ""
        };
    }

    private static JsonElement GetProp(JsonElement e, string name)
        => e.TryGetProperty(name, out var v) ? v : default;

    private static string MetricToText(JsonElement m)
    {
        if (m.ValueKind != JsonValueKind.Object) return "";
        var agg = m.TryGetProperty("aggregation", out var a) ? a.GetString() ?? "SUM" : "SUM";
        var field = m.TryGetProperty("field", out var f) ? f.GetString() ?? "amount" : "amount";
        var type = m.TryGetProperty("transactionType", out var t) ? t.GetString() ?? "all" : "all";
        var parts = new List<string>();
        if (type != "all") parts.Add($"type={type}");
        if (m.TryGetProperty("filters", out var filters) && filters.ValueKind == JsonValueKind.Array)
        {
            foreach (var fl in filters.EnumerateArray())
            {
                var ff = fl.TryGetProperty("field", out var fld) ? fld.GetString() : "";
                var op = fl.TryGetProperty("operator", out var o) ? o.GetString() : "=";
                var v = fl.TryGetProperty("value", out var vv) ? vv.GetRawText() : "";
                parts.Add($"{ff}{op}{v}");
            }
        }
        var where = string.Join(" AND ", parts);
        return $"{agg}({field})" + (string.IsNullOrEmpty(where) ? "" : $" WHERE {where}");
    }
}
