using System.Text.Json;
using Commission.Api.Data;
using Dapper;

namespace Commission.Api.Engine;

/// <summary>
/// Faithful port of server/src/engine/formulaEvaluator.js.
/// Reads structured JSON formulas from kpi_definitions.formula and evaluates
/// them against a transaction list, falling back to direct DB queries for
/// growth (previous-period) and team (descendants) types.
/// </summary>
public class FormulaEvaluator
{
    private static readonly HashSet<string> ValidFields = new() {
        "amount", "quantity", "customer_id", "product_id", "base_amount"
    };
    private static readonly HashSet<string> ValidFilterFields = new() {
        "is_strategic", "is_new_launch", "product_category", "product_sku",
        "customer_channel", "customer_group", "event_type", "tag"
    };
    private static readonly HashSet<string> ValidAggregations = new() {
        "SUM", "COUNT_DISTINCT", "AVG", "COUNT"
    };
    private static readonly HashSet<string> ValidTxTypes = new() {
        "sale", "return", "collection", "event", "all"
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
        var formula = ParseFormula(formulaJson);
        if (formula is null) return null;

        var type = formula.Value.TryGetProperty("type", out var t) ? t.GetString() : null;
        return type switch
        {
            "simple"  => EvaluateSimple(formula.Value, transactions),
            "ratio"   => EvaluateRatio(formula.Value, transactions),
            "growth"  => await EvaluateGrowthAsync(formula.Value, transactions, employee, period, ct),
            "team"    => await EvaluateTeamAsync(formula.Value, employee, period, ct),
            "static"  => formula.Value.TryGetProperty("defaultValue", out var d) && d.TryGetDouble(out var dv) ? dv : 0,
            _ => null
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

    private static double EvaluateMetric(JsonElement metric, List<Transaction> txns)
    {
        var filtered = FilterTransactions(metric, txns);
        var aggregation = metric.TryGetProperty("aggregation", out var a) ? a.GetString() ?? "SUM" : "SUM";
        var field = metric.TryGetProperty("field", out var f) ? f.GetString() ?? "amount" : "amount";
        return Aggregate(filtered, aggregation, field);
    }

    private static List<Transaction> FilterTransactions(JsonElement metric, List<Transaction> txns)
    {
        IEnumerable<Transaction> filtered = txns;

        if (metric.TryGetProperty("transactionType", out var tt))
        {
            var txType = tt.GetString();
            if (!string.IsNullOrEmpty(txType) && txType != "all")
                filtered = filtered.Where(t => t.TransactionType == txType);
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
            "product_category" => t.ProductCategory,
            "product_sku"      => t.Sku,
            "is_strategic"     => t.IsStrategic,
            "is_new_launch"    => t.IsNewLaunch,
            "customer_channel" => t.CustomerChannel,
            "customer_group"   => t.CustomerGroup,
            "event_type"       => t.EventType,
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
        _ => 0
    };

    private static string GetFieldStr(Transaction t, string field) => field switch
    {
        "customer_id" => t.CustomerId ?? "",
        "product_id" => t.ProductId ?? "",
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

        var prev = await QueryMetricAsync(baseMetric, employee.Id, prevPeriod, ct);
        if (prev == 0) return 0;
        return ((current - prev) / prev) * 100;
    }

    private async Task<double> EvaluateTeamAsync(
        JsonElement formula, Employee employee, string period, CancellationToken ct)
    {
        if (!formula.TryGetProperty("baseMetric", out var baseMetric)) return 0;
        var reports = await _db.QueryAsync<dynamic>(
            "SELECT id FROM employees WHERE reports_to = @id", new { id = employee.Id }, ct: ct);
        var values = new List<double>();
        foreach (var rep in reports)
        {
            var v = await QueryMetricAsync(baseMetric, (string)rep.id, period, ct);
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

    private async Task<double> QueryMetricAsync(JsonElement metric, string employeeId, string period, CancellationToken ct)
    {
        var txType = metric.TryGetProperty("transactionType", out var tt) ? tt.GetString() ?? "sale" : "sale";
        if (!ValidTxTypes.Contains(txType)) txType = "sale";
        var field = metric.TryGetProperty("field", out var f) ? f.GetString() ?? "amount" : "amount";
        if (!ValidFields.Contains(field)) field = "amount";
        var agg = metric.TryGetProperty("aggregation", out var a) ? a.GetString() ?? "SUM" : "SUM";
        if (!ValidAggregations.Contains(agg)) agg = "SUM";

        var paramDict = new Dictionary<string, object>
        {
            ["empId"] = employeeId,
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
                if (ff is "is_strategic" or "is_new_launch" or "product_category" or "product_sku") needsProductJoin = true;
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
        if (needsProductJoin)  joins += " JOIN products p ON t.product_id = p.id";
        if (needsCustomerJoin) joins += " JOIN customers c ON t.customer_id = c.id";

        var typeClause = txType != "all" ? $" AND t.transaction_type = '{txType}'" : "";

        string aggExpr = agg switch
        {
            "SUM" => $"COALESCE(SUM(t.{field}), 0)",
            "COUNT" => "COUNT(*)",
            "COUNT_DISTINCT" => $"COUNT(DISTINCT t.{field})",
            "AVG" => $"COALESCE(AVG(t.{field}), 0)",
            _ => $"COALESCE(SUM(t.{field}), 0)"
        };

        var sql = $"SELECT {aggExpr} AS val FROM transactions t{joins} " +
                  $"WHERE t.employee_id = @empId AND t.period = @period{typeClause}{string.Join("", filterClauses)}";

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
        "is_strategic"     => "p.is_strategic",
        "is_new_launch"    => "p.is_new_launch",
        "product_category" => "p.category",
        "product_sku"      => "p.sku",
        "customer_channel" => "c.channel",
        "customer_group"   => "c.customer_group",
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
