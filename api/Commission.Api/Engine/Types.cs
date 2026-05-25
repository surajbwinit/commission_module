using System.Text.Json;

namespace Commission.Api.Engine;

// =====================================================================
// Engine value types — mirror the shapes used by the JS pipeline.
// All numeric fields use double for parity with JavaScript number math.
// =====================================================================

public class Transaction
{
    public string Id { get; set; } = "";
    public string EmployeeId { get; set; } = "";
    public string? CustomerId { get; set; }
    public string? ProductId { get; set; }
    public string TransactionType { get; set; } = "sale";  // sale|return|collection|event
    public double Quantity { get; set; }
    public double Amount { get; set; }
    public DateTime TransactionDate { get; set; }
    public string Period { get; set; } = "";
    public string? TerritoryId { get; set; }
    public string Currency { get; set; } = "AED";
    public double BaseAmount { get; set; }
    public double ExchangeRate { get; set; } = 1.0;

    // Joined product columns
    public string? ProductName { get; set; }
    public string? ProductCategory { get; set; }
    public string? Sku { get; set; }
    public int IsStrategic { get; set; }
    public int IsNewLaunch { get; set; }
    public string ProductTags { get; set; } = "[]";

    // Joined customer columns
    public string? CustomerName { get; set; }
    public string? CustomerChannel { get; set; }
    public string? CustomerGroup { get; set; }
    public string? CustomerGroupName { get; set; }
    public string CustomerTags { get; set; } = "[]";

    // Event-source helpers (set when promoted from commission_events)
    public bool EventSource { get; set; }
    public string? EventType { get; set; }
    public string? ReferenceId { get; set; }
    public Dictionary<string, object?>? Metadata { get; set; }

    // Cached parsed tag ids for §22.8 tag filter matching
    public List<string>? TagIds { get; set; }
}

public class Employee
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Email { get; set; }
    public string? ExternalId { get; set; }
    public string RoleId { get; set; } = "";
    public string? TerritoryId { get; set; }
    public string? ReportsTo { get; set; }
    public double BaseSalary { get; set; }
    public DateTime HireDate { get; set; }
    public int IsActive { get; set; }
    public string? RoleName { get; set; }
}

public class PlanRow
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string Status { get; set; } = "draft";
    public string PlanType { get; set; } = "monthly";
    public DateTime EffectiveFrom { get; set; }
    public DateTime EffectiveTo { get; set; }
    public double BasePayout { get; set; }
    public string Currency { get; set; } = "AED";
    public string? CreatedBy { get; set; }
}

public class PlanKpi
{
    public string Id { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string KpiId { get; set; } = "";
    public double Weight { get; set; }
    public double TargetValue { get; set; }
    public string? SlabSetId { get; set; }

    // Joined KPI definition
    public string KpiName { get; set; } = "";
    public string KpiCode { get; set; } = "";
    public string KpiCategory { get; set; } = "";
    public string Formula { get; set; } = "";
    public string Unit { get; set; } = "currency";
    public string Direction { get; set; } = "higher_is_better";
}

public class SlabSet
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "step";
    public string? PlanId { get; set; }
    public string? KpiId { get; set; }
    public string? RoleId { get; set; }
    public List<SlabTier> Tiers { get; set; } = new();
}

public class SlabTier
{
    public string Id { get; set; } = "";
    public string SlabSetId { get; set; } = "";
    public int TierOrder { get; set; }
    public double MinPercent { get; set; }
    public double? MaxPercent { get; set; }
    public double Rate { get; set; }
    public string RateType { get; set; } = "percentage";
    public int MinInclusive { get; set; } = 1;
    public int MaxInclusive { get; set; } = 0;
}

public class RuleSet
{
    public string Id { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public List<Rule> Rules { get; set; } = new();
}

public class Rule
{
    public string Id { get; set; } = "";
    public string RuleSetId { get; set; } = "";
    public string? ParentRuleId { get; set; }
    public string Dimension { get; set; } = "";
    public string RuleType { get; set; } = "include";
    public string MatchType { get; set; } = "exact";
    public string MatchValues { get; set; } = "[]";
    public int Priority { get; set; }
    public DateTime? ValidFrom { get; set; }
    public DateTime? ValidTo { get; set; }
    public string? ConditionalLogic { get; set; }
}

public class EligibilityRule
{
    public string Id { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string Metric { get; set; } = "";
    public string Operator { get; set; } = ">=";
    public double Threshold { get; set; }
    public string Action { get; set; } = "zero_payout";
    public double ReductionPercent { get; set; }
    public int IsActive { get; set; } = 1;
}

public class MultiplierRule
{
    public string Id { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public string ConditionMetric { get; set; } = "";
    public string ConditionOperator { get; set; } = ">=";
    public double ConditionValue { get; set; }
    public double MultiplierValue { get; set; } = 1.0;
    public string StackingMode { get; set; } = "multiplicative";
    public int IsActive { get; set; } = 1;
}

public class KpiDeductionRule
{
    public string Id { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string? KpiId { get; set; }
    public string? RoleId { get; set; }
    public string Name { get; set; } = "";
    public string MetricType { get; set; } = "shortfall_percent";
    public double? MinValue { get; set; }
    public double? MaxValue { get; set; }
    public int MinInclusive { get; set; } = 1;
    public int MaxInclusive { get; set; } = 1;
    public double DeductionPercent { get; set; }
    public int Priority { get; set; }
    public int IsActive { get; set; } = 1;
}

public class PenaltyRule
{
    public string Id { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string Name { get; set; } = "";
    public string TriggerMetric { get; set; } = "";
    public string TriggerOperator { get; set; } = ">";
    public double TriggerValue { get; set; }
    public string PenaltyType { get; set; } = "percentage";
    public double PenaltyValue { get; set; }
    public int IsActive { get; set; } = 1;
}

public class CappingRule
{
    public string Id { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string CapType { get; set; } = "";
    public double CapValue { get; set; }
    public int IsActive { get; set; } = 1;
}

public class SplitRule
{
    public string Id { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string Name { get; set; } = "";
    public string? TriggerCondition { get; set; }
    public int IsActive { get; set; } = 1;
    public List<SplitParticipant> Participants { get; set; } = new();
}

public class SplitParticipant
{
    public string Id { get; set; } = "";
    public string SplitRuleId { get; set; } = "";
    public string RoleId { get; set; } = "";
    public double SplitPercent { get; set; }
}

public class MonthlyTarget
{
    public string Id { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string KpiId { get; set; } = "";
    public string? RoleId { get; set; }
    public string Period { get; set; } = "";
    public double TargetValue { get; set; }
}

public class FixedIncentiveRule
{
    public string Id { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string? RoleId { get; set; }
    public string? Period { get; set; }
    public string Name { get; set; } = "";
    public double Amount { get; set; }
    public string? ConditionKpiId { get; set; }
    public string ConditionOperator { get; set; } = ">=";
    public double? ConditionValue { get; set; }
    public int IsActive { get; set; } = 1;
}

// =====================================================================
// Engine intermediate results
// =====================================================================

public class KpiAchievement
{
    public double Actual { get; set; }
    public double Target { get; set; }
    public double Percent { get; set; }
}

public class SlabResult
{
    public string Type { get; set; } = "";
    public double Rate { get; set; }
    public string RateType { get; set; } = "percentage";
    public double AppliedPoints { get; set; }
    public int Tier { get; set; }
    public bool IsAccelerated { get; set; }
    public object? Details { get; set; }
}

public class KpiPayoutAmount
{
    public double Amount { get; set; }
    public double BasePayout { get; set; }
    public double SlabRate { get; set; }
    public string RateType { get; set; } = "percentage";
}

public class KpiResultRow
{
    public string KpiId { get; set; } = "";
    public string KpiName { get; set; } = "";
    public string KpiCode { get; set; } = "";
    public string KpiCategory { get; set; } = "";
    public string Unit { get; set; } = "";
    public double TargetValue { get; set; }
    public double ActualValue { get; set; }
    public double AchievementPercent { get; set; }
    public double SlabRate { get; set; }
    public string? SlabType { get; set; }
    public double RawPayout { get; set; }
    public double WeightedPayout { get; set; }
    public double Weight { get; set; }
    public string CalculationDetails { get; set; } = "{}";
}

public class EligibilityResult
{
    public string Status { get; set; } = "eligible";  // eligible|reduced|ineligible
    public double Reduction { get; set; }
    public List<Dictionary<string, object?>> Details { get; set; } = new();
}

public class MultiplierResult
{
    public double Amount { get; set; }
    public List<Dictionary<string, object?>> Applied { get; set; } = new();
    public double FinalMultiplier { get; set; } = 1.0;
    public Dictionary<string, double> Metrics { get; set; } = new();
}

public class PenaltyResult
{
    public double Amount { get; set; }
    public List<Dictionary<string, object?>> Triggered { get; set; } = new();
    public double TotalPenaltyPercent { get; set; }
}

public class CapResult
{
    public double Capped { get; set; }
    public double Adjustment { get; set; }
    public Dictionary<string, object?>? Applied { get; set; }
}

public class KpiDeductionResult
{
    public double Amount { get; set; }
    public double TotalPercent { get; set; }
    public List<Dictionary<string, object?>> Triggered { get; set; } = new();
}

public class TagContext
{
    public Dictionary<string, List<string>> ProductTags { get; set; } = new();
    public Dictionary<string, List<string>> CustomerTags { get; set; } = new();
    public Dictionary<string, List<string>> TerritoryTags { get; set; } = new();
}

public class PipelineRunRequest
{
    public string PlanId { get; set; } = "";
    public string Period { get; set; } = "";
    public string? CreatedBy { get; set; }
    public bool IsSimulation { get; set; }
    public Dictionary<string, object?>? Overrides { get; set; }
    public string? EmployeeId { get; set; }
}

public class PipelineRunResult
{
    public string RunId { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string Period { get; set; } = "";
    public string Status { get; set; } = "completed";
    public bool IsSimulation { get; set; }
    public double TotalPayout { get; set; }
    public int EmployeeCount { get; set; }
    public List<Dictionary<string, object?>> Payouts { get; set; } = new();
    public List<Dictionary<string, object?>> Steps { get; set; } = new();
    public string? Message { get; set; }
}

// JSON helpers shared by the engine
public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public static string Serialize(object? value) => JsonSerializer.Serialize(value, Options);
    public static T? Deserialize<T>(string json) => JsonSerializer.Deserialize<T>(json, Options);

    public static JsonElement? ParseElement(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonDocument.Parse(json).RootElement.Clone(); }
        catch { return null; }
    }

    public static List<string> ParseStringArray(string? json)
    {
        var elem = ParseElement(json);
        if (elem is null || elem.Value.ValueKind != JsonValueKind.Array) return new List<string>();
        var result = new List<string>();
        foreach (var item in elem.Value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String) result.Add(item.GetString() ?? "");
            else if (item.ValueKind == JsonValueKind.Number) result.Add(item.GetRawText());
            else result.Add(item.ToString());
        }
        return result;
    }
}
