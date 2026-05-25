using System.Text.Json;
using Commission.Api.Data;

namespace Commission.Api.Engine;

/// <summary>
/// Port of server/src/engine/step02_mappingFilters.js — the advanced rule engine.
/// Supports §22.2 exclude-overrides-include, §22.4 nested rules (parent_rule_id),
/// §22.7 conditional logic, §22.8 tag matching, §22.10 time-bound rules.
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
        var topLevel = allRules.Where(r => string.IsNullOrEmpty(r.ParentRuleId)).ToList();
        var includes = topLevel.Where(r => r.RuleType == "include").ToList();
        var excludes = topLevel.Where(r => r.RuleType == "exclude").ToList();

        return transactions.Where(t =>
        {
            // Exclude wins (§22.6)
            foreach (var ex in excludes)
                if (RuleMatchesRecursive(ex, allRules, t, tagContext, asOf)) return false;

            // If any include exists, must match at least one
            if (includes.Count > 0)
                return includes.Any(inc => RuleMatchesRecursive(inc, allRules, t, tagContext, asOf));

            return true;
        }).ToList();
    }

    private static bool RuleMatchesRecursive(Rule rule, List<Rule> all, Transaction t, TagContext? tagCtx, DateTime asOf)
    {
        if (!RuleMatches(rule, t, tagCtx, asOf)) return false;
        var children = all.Where(r => r.ParentRuleId == rule.Id).ToList();
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

        return rule.Dimension switch
        {
            "product"           => values.Contains(t.ProductId ?? ""),
            "product_category"  => values.Contains(t.ProductCategory ?? ""),
            "product_sku"       => values.Contains(t.Sku ?? ""),
            "customer"          => values.Contains(t.CustomerId ?? ""),
            "customer_channel"  => values.Contains(t.CustomerChannel ?? ""),
            "customer_group"    => values.Contains(t.CustomerGroup ?? ""),
            "territory"         => values.Contains(t.TerritoryId ?? ""),
            "transaction_type"  => values.Contains(t.TransactionType),
            _ => false
        };
    }

    private static bool TxnMatchesTags(Transaction t, List<string> tagIds, TagContext? tagCtx)
    {
        if (tagCtx is null) return false;
        var prodTags = (t.ProductId != null && tagCtx.ProductTags.TryGetValue(t.ProductId, out var pt)) ? pt : new();
        var custTags = (t.CustomerId != null && tagCtx.CustomerTags.TryGetValue(t.CustomerId, out var ct)) ? ct : new();
        var terrTags = (t.TerritoryId != null && tagCtx.TerritoryTags.TryGetValue(t.TerritoryId, out var tt)) ? tt : new();
        var all = new HashSet<string>(prodTags.Concat(custTags).Concat(terrTags));
        return tagIds.Any(all.Contains);
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
        "product_id"       => t.ProductId,
        "customer_id"      => t.CustomerId,
        "amount"           => t.Amount,
        "quantity"         => t.Quantity,
        "transaction_type" => t.TransactionType,
        "product_category" => t.ProductCategory,
        "customer_channel" => t.CustomerChannel,
        "customer_group"   => t.CustomerGroup,
        "is_strategic"     => t.IsStrategic,
        "is_new_launch"    => t.IsNewLaunch,
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

    public async Task<TagContext> BuildTagContextAsync(CancellationToken ct = default)
    {
        var rows = await _db.QueryDynamicAsync(
            "SELECT tag_id, entity_type, entity_id, valid_from, valid_to FROM entity_tags",
            ct: ct);
        var today = DateTime.UtcNow.Date;
        var ctx = new TagContext();
        foreach (var row in rows)
        {
            DateTime? vf = row.valid_from;
            DateTime? vt = row.valid_to;
            if (vf.HasValue && today < vf.Value.Date) continue;
            if (vt.HasValue && today > vt.Value.Date) continue;
            string entityType = row.entity_type;
            string entityId   = row.entity_id;
            string tagId      = row.tag_id;
            var dict = entityType switch
            {
                "product"   => ctx.ProductTags,
                "customer"  => ctx.CustomerTags,
                "territory" => ctx.TerritoryTags,
                _ => null
            };
            if (dict is null) continue;
            if (!dict.TryGetValue(entityId, out var list)) { list = new(); dict[entityId] = list; }
            list.Add(tagId);
        }
        return ctx;
    }
}
