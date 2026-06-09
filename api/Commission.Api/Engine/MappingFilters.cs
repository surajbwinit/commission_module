using System.Text.Json;
using Commission.Api.Data;

namespace Commission.Api.Engine;

/// <summary>
/// Mapping rules — §22.2 exclude-overrides-include, §22.4 nested rules,
/// §22.7 conditional logic, §22.8 tag matching, §22.10 time-bound rules.
/// All operates on uid-based transaction fields.
/// </summary>
public class MappingFilters
{
    private readonly IDb _db;
    public MappingFilters(IDb db) { _db = db; }

    public List<Transaction> Apply(
        List<Transaction> transactions,
        List<RuleSet> ruleSets,
        TagContext? tagContext,
        DateTime asOf)
    {
        if (ruleSets is null || ruleSets.Count == 0) return transactions;

        var allRules = ruleSets.SelectMany(rs => rs.Rules).ToList();
        var topLevel = allRules.Where(r => string.IsNullOrEmpty(r.ParentRuleUid)).ToList();
        var includes = topLevel.Where(r => r.RuleType == "include").ToList();
        var excludes = topLevel.Where(r => r.RuleType == "exclude").ToList();

        return transactions.Where(t =>
        {
            foreach (var ex in excludes)
                if (RuleMatchesRecursive(ex, allRules, t, tagContext, asOf)) return false;

            if (includes.Count > 0)
                return includes.Any(inc => RuleMatchesRecursive(inc, allRules, t, tagContext, asOf));

            return true;
        }).ToList();
    }

    private static bool RuleMatchesRecursive(Rule rule, List<Rule> all, Transaction t, TagContext? tagCtx, DateTime asOf)
    {
        if (!RuleMatches(rule, t, tagCtx, asOf)) return false;
        var children = all.Where(r => r.ParentRuleUid == rule.Uid).ToList();
        if (children.Count == 0) return true;

        foreach (var child in children)
        {
            if (child.RuleType == "exclude" && RuleMatches(child, t, tagCtx, asOf)) return false;
            if (child.RuleType == "include" && !RuleMatches(child, t, tagCtx, asOf)) return false;
        }
        return true;
    }

    private static bool RuleMatches(Rule rule, Transaction t, TagContext? tagCtx, DateTime asOf)
    {
        if (rule.ValidFrom.HasValue && asOf < rule.ValidFrom.Value) return false;
        if (rule.ValidTo.HasValue && asOf > rule.ValidTo.Value) return false;
        if (!EvaluateConditional(rule.ConditionalLogic, t)) return false;

        var values = ParseValues(rule.MatchValues);
        if (values.Count == 0) return false;

        if (rule.MatchType == "tag")
            return TxnMatchesTags(t, values, tagCtx);

        // Dimension mapping — all matches by uid (or denormalized name where uid not present)
        return rule.Dimension switch
        {
            "product"             => values.Contains(t.ProductUid ?? ""),
            "product_brand"       => values.Contains(t.ProductBrandUid ?? "")
                                  || values.Contains(t.ProductBrandName ?? ""),
            "product_category"    => values.Contains(t.ProductCategoryUid ?? "")
                                  || values.Contains(t.ProductCategoryName ?? ""),
            "product_subcategory" => values.Contains(t.ProductSubcategoryUid ?? "")
                                  || values.Contains(t.ProductSubcategoryName ?? ""),
            "product_sku"         => values.Contains(t.ProductCode ?? ""),    // SKU = product code
            "customer"            => values.Contains(t.CustomerUid ?? ""),
            "customer_channel"    => values.Contains(t.CustomerChannelUid ?? "")
                                  || values.Contains(t.CustomerChannelName ?? ""),
            "customer_group"      => values.Contains(t.CustomerGroupUid ?? "")
                                  || values.Contains(t.CustomerGroupName ?? ""),
            "territory"           => values.Contains(t.SalesOfficeUid ?? ""),
            "transaction_type"    => values.Contains(t.TransactionType),
            _ => false
        };
    }

    private static bool TxnMatchesTags(Transaction t, List<string> tagIds, TagContext? tagCtx)
    {
        // Product tags now live on products.tags JSONB (loaded into t.TagIds upstream).
        // Customer/SalesOffice tag dictionaries are kept for future extensibility.
        var tags = t.TagIds ?? new List<string>();
        if (tagCtx != null)
        {
            if (t.CustomerUid != null && tagCtx.CustomerTags.TryGetValue(t.CustomerUid, out var ct))
                tags = tags.Concat(ct).ToList();
            if (t.SalesOfficeUid != null && tagCtx.SalesOfficeTags.TryGetValue(t.SalesOfficeUid, out var st))
                tags = tags.Concat(st).ToList();
        }
        return tagIds.Any(tags.Contains);
    }

    private static bool EvaluateConditional(string? logic, Transaction t)
    {
        if (string.IsNullOrWhiteSpace(logic)) return true;
        try
        {
            var doc = JsonDocument.Parse(logic);
            var root = doc.RootElement;
            if (!root.TryGetProperty("if", out var iff)) return true;
            var field = iff.TryGetProperty("field", out var f) ? f.GetString() : null;
            var op = iff.TryGetProperty("op", out var o) ? o.GetString() : "=";
            if (field is null) return true;

            object? actual = GetFieldValue(t, field);
            var value = iff.TryGetProperty("value", out var v) ? v : default;

            bool cond = op switch
            {
                "=" or "==" => CompareEq(actual, value),
                "!="        => !CompareEq(actual, value),
                ">"         => CompareNum(actual, value) > 0,
                "<"         => CompareNum(actual, value) < 0,
                ">="        => CompareNum(actual, value) >= 0,
                "<="        => CompareNum(actual, value) <= 0,
                "in"        => value.ValueKind == JsonValueKind.Array && value.EnumerateArray().Any(e => CompareEq(actual, e)),
                "not_in"    => value.ValueKind == JsonValueKind.Array && !value.EnumerateArray().Any(e => CompareEq(actual, e)),
                _ => true
            };
            var then = root.TryGetProperty("then", out var th) ? th.GetString() : null;
            var els  = root.TryGetProperty("else", out var el) ? el.GetString() : null;
            return cond ? then != "skip" : els != "skip";
        }
        catch { return true; }
    }

    private static object? GetFieldValue(Transaction t, string field) => field switch
    {
        "product_uid"         => t.ProductUid,
        "customer_uid"        => t.CustomerUid,
        "amount"              => t.Amount,
        "quantity"            => t.Quantity,
        "transaction_type"    => t.TransactionType,
        "product_brand"       => t.ProductBrandName       ?? t.ProductBrandUid,
        "product_category"    => t.ProductCategoryName    ?? t.ProductCategoryUid,
        "product_subcategory" => t.ProductSubcategoryName ?? t.ProductSubcategoryUid,
        "customer_channel"    => t.CustomerChannelName ?? t.CustomerChannelUid,
        "customer_group"      => t.CustomerGroupName ?? t.CustomerGroupUid,
        "is_strategic"        => t.IsStrategic,
        "is_new_launch"       => t.IsNewLaunch,
        _ => null
    };

    private static bool CompareEq(object? actual, JsonElement value)
    {
        var s = value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? "",
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => value.ToString()
        };
        return string.Equals(actual?.ToString(), s, StringComparison.Ordinal) ||
               (double.TryParse(actual?.ToString(), out var a) &&
                double.TryParse(s, out var b) && a == b);
    }

    private static int CompareNum(object? actual, JsonElement value)
    {
        if (!double.TryParse(actual?.ToString(), out var a)) return 0;
        if (!double.TryParse(value.ToString(), out var b)) return 0;
        return a.CompareTo(b);
    }

    private static List<string> ParseValues(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return new();
        try
        {
            var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
                return doc.RootElement.EnumerateArray()
                    .Select(e => e.ValueKind == JsonValueKind.String ? e.GetString() ?? "" : e.GetRawText())
                    .ToList();
            return new List<string> { raw };
        }
        catch { return new List<string> { raw }; }
    }

    /// <summary>
    /// Tag context — placeholder. The old entity_tags / tags tables are dropped.
    /// Product tags are loaded inline from products.tags JSONB (handled in Steps).
    /// Returns an empty context so existing callers continue to work.
    /// </summary>
    public Task<TagContext> BuildTagContextAsync(CancellationToken ct = default)
        => Task.FromResult(new TagContext());
}
