using System.Text.Json;

namespace Commission.Api.Engine;

// =====================================================================
// Engine value types — shapes returned by Dapper, consumed by the pipeline.
//
// CONVENTION:
//   - Uid           = business key, target of FKs (maps to <table>.uid)
//   - <Other>Uid    = FK to another table (maps to <other>_uid column)
//   - Code / Name   = display fields (uid is opaque)
//   - All numeric fields use double for JS-compatible math
// =====================================================================

public class Transaction
{
    public string Uid { get; set; } = "";
    public string EmpUid { get; set; } = "";
    public string? CustomerUid { get; set; }
    public string? ProductUid { get; set; }
    public string TransactionType { get; set; } = "sale";   // sale|return|collection|crate_load|case_delivery|pallet_handling
    public double Quantity { get; set; }
    public double Amount { get; set; }
    public DateTime TransactionDate { get; set; }
    public string Period { get; set; } = "";
    public string? SalesOfficeUid { get; set; }
    public string CurrencyUid { get; set; } = "";        // FK to currency.uid
    public double BaseAmount { get; set; }
    public double ExchangeRate { get; set; } = 1.0;
    public string? SourceParentUid { get; set; }         // e.g. invoice.uid for invoice_line rows

    // Joined product columns (display + filter)
    public string? ProductCode { get; set; }
    public string? ProductName { get; set; }
    public string? ProductBrandUid { get; set; }                  // FK to product_groups (Brand type)
    public string? ProductBrandName { get; set; }                 // flattened display
    public string? ProductCategoryUid { get; set; }
    public string? ProductCategoryName { get; set; }
    public string? ProductSubcategoryUid { get; set; }
    public string? ProductSubcategoryName { get; set; }
    public bool IsStrategic { get; set; }
    public bool IsNewLaunch { get; set; }
    public string ProductTags { get; set; } = "[]";

    // Joined customer columns (display only)
    public string? CustomerCode { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerChannelUid { get; set; }      // FK uid
    public string? CustomerChannelName { get; set; }     // flattened display
    public string? CustomerGroupUid { get; set; }        // FK uid
    public string? CustomerGroupName { get; set; }       // flattened display

    // Cached parsed tag ids (legacy — products.tags is JSONB now; populated from there)
    public List<string>? TagIds { get; set; }
}

public class Employee
{
    public string Uid { get; set; } = "";
    public string? EmpCode { get; set; }
    public string Name { get; set; } = "";
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public string RoleUid { get; set; } = "";
    public string? RoleCode { get; set; }                // flattened from roles
    public string? RoleNameEn { get; set; }              // flattened from roles
    public string? Designation { get; set; }
    public string? Department { get; set; }
    public string? SalesOfficeUid { get; set; }
    public string? SalesOfficeName { get; set; }         // flattened
    public string? BranchUid { get; set; }
    public string? ReportsToUid { get; set; }
    public double BaseSalary { get; set; }
    public DateTime? HireDate { get; set; }
    public bool IsActive { get; set; }
}

public class PlanRow
{
    public string Uid { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string Status { get; set; } = "draft";
    public string PlanType { get; set; } = "monthly";
    public DateTime EffectiveFrom { get; set; }
    public DateTime EffectiveTo { get; set; }
    public double BasePayout { get; set; }
    public string? CurrencyUid { get; set; }
    public string? OrgUid { get; set; }
    public string? CreatedBy { get; set; }
}

public class PlanKpi
{
    public string Uid { get; set; } = "";
    public string PlanUid { get; set; } = "";
    public string KpiUid { get; set; } = "";
    public double Weight { get; set; }
    public double TargetValue { get; set; }
    public string? SlabSetUid { get; set; }

    // Joined KPI definition (display)
    public string KpiName { get; set; } = "";
    public string KpiCode { get; set; } = "";
    public string KpiCategory { get; set; } = "";
    public string Formula { get; set; } = "{}";
    public string Unit { get; set; } = "currency";
    public string Direction { get; set; } = "higher_is_better";
}

public class SlabSet
{
    public string Uid { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "step";
    public string? PlanUid { get; set; }
    public string? KpiUid { get; set; }
    public string? RoleUid { get; set; }
    public List<SlabTier> Tiers { get; set; } = new();
}

public class SlabTier
{
    public string Uid { get; set; } = "";
    public string SlabSetUid { get; set; } = "";
    public int TierOrder { get; set; }
    public double MinPercent { get; set; }
    public double? MaxPercent { get; set; }
    public double Rate { get; set; }
    public string RateType { get; set; } = "percentage";
    public bool MinInclusive { get; set; } = true;
    public bool MaxInclusive { get; set; }
}

public class RuleSet
{
    public string Uid { get; set; } = "";
    public string PlanUid { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public List<Rule> Rules { get; set; } = new();
}

public class Rule
{
    public string Uid { get; set; } = "";
    public string RuleSetUid { get; set; } = "";
    public string? ParentRuleUid { get; set; }
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
    public string Uid { get; set; } = "";
    public string PlanUid { get; set; } = "";
    public string Metric { get; set; } = "";
    public string Operator { get; set; } = ">=";
    public double Threshold { get; set; }
    public string Action { get; set; } = "zero_payout";
    public double ReductionPercent { get; set; }
    public bool IsActive { get; set; } = true;
}

public class MultiplierRule
{
    public string Uid { get; set; } = "";
    public string PlanUid { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public string ConditionMetric { get; set; } = "";
    public string ConditionOperator { get; set; } = ">=";
    public double ConditionValue { get; set; }
    public double MultiplierValue { get; set; } = 1.0;
    public string StackingMode { get; set; } = "multiplicative";
    public bool IsActive { get; set; } = true;
}

public class KpiDeductionRule
{
    public string Uid { get; set; } = "";
    public string PlanUid { get; set; } = "";
    public string? KpiUid { get; set; }
    public string? RoleUid { get; set; }
    public string Name { get; set; } = "";
    public string MetricType { get; set; } = "shortfall_percent";
    public double? MinValue { get; set; }
    public double? MaxValue { get; set; }
    public bool MinInclusive { get; set; } = true;
    public bool MaxInclusive { get; set; } = true;
    public double DeductionPercent { get; set; }
    public int Priority { get; set; }
    public bool IsActive { get; set; } = true;
}

public class PenaltyRule
{
    public string Uid { get; set; } = "";
    public string PlanUid { get; set; } = "";
    public string Name { get; set; } = "";
    public string TriggerMetric { get; set; } = "";
    public string TriggerOperator { get; set; } = ">";
    public double TriggerValue { get; set; }
    public string PenaltyType { get; set; } = "percentage";
    public double PenaltyValue { get; set; }
    public bool IsActive { get; set; } = true;
}

public class CappingRule
{
    public string Uid { get; set; } = "";
    public string PlanUid { get; set; } = "";
    public string CapType { get; set; } = "";
    public double CapValue { get; set; }
    public bool IsActive { get; set; } = true;
}

public class SplitRule
{
    public string Uid { get; set; } = "";
    public string PlanUid { get; set; } = "";
    public string Name { get; set; } = "";
    public string? TriggerCondition { get; set; }
    public bool IsActive { get; set; } = true;
    public List<SplitParticipant> Participants { get; set; } = new();
}

public class SplitParticipant
{
    public string Uid { get; set; } = "";
    public string SplitRuleUid { get; set; } = "";
    public string RoleUid { get; set; } = "";
    public double SplitPercent { get; set; }
}

public class MonthlyTarget
{
    public string Uid { get; set; } = "";
    public string PlanUid { get; set; } = "";
    public string KpiUid { get; set; } = "";
    public string? RoleUid { get; set; }
    public string Period { get; set; } = "";
    public double TargetValue { get; set; }
}

public class FixedIncentiveRule
{
    public string Uid { get; set; } = "";
    public string PlanUid { get; set; } = "";
    public string? RoleUid { get; set; }
    public string? Period { get; set; }
    public string Name { get; set; } = "";
    public double Amount { get; set; }
    public string? ConditionKpiUid { get; set; }
    public string ConditionOperator { get; set; } = ">=";
    public double? ConditionValue { get; set; }
    public bool IsActive { get; set; } = true;
}

// =====================================================================
// Engine intermediate results (no DB persistence, in-memory only)
// =====================================================================

public class KpiAchievement
{
    public double Actual { get; set; }
    public double Target { get; set; }          // the % goal from plan_kpis.target_value
    public double Percent { get; set; }

    // Formula inputs persisted on kpi_results so each row is self-documenting.
    // Nulls for legacy/fallback paths that don't go through EvaluateDetailedAsync.
    public double? Numerator { get; set; }
    public double? Denominator { get; set; }
    public string? NumeratorUnit { get; set; }
    public string? DenominatorUnit { get; set; }
    public string? ActualUnit { get; set; }
    public string FormulaType { get; set; } = "legacy";
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
    public string KpiUid { get; set; } = "";
    public string KpiName { get; set; } = "";
    public string KpiCode { get; set; } = "";
    public string KpiCategory { get; set; } = "";
    public string Unit { get; set; } = "";
    public double TargetValue { get; set; }       // legacy — kept = the % goal, for back-compat
    public double ActualValue { get; set; }
    public double AchievementPercent { get; set; }
    public double SlabRate { get; set; }
    public string? SlabType { get; set; }
    public double RawPayout { get; set; }
    public double WeightedPayout { get; set; }
    public double Weight { get; set; }
    public string CalculationDetails { get; set; } = "{}";

    // New, self-documenting columns persisted to kpi_results.
    // null for KPIs that fall back to LegacyCalculateAsync (no formula JSON).
    public double? NumeratorValue { get; set; }
    public double? DenominatorValue { get; set; }
    public string? NumeratorUnit { get; set; }
    public string? DenominatorUnit { get; set; }
    public string? ActualUnit { get; set; }
    public double? GoalThresholdPercent { get; set; }   // canonical name; same value as TargetValue
    public string FormulaType { get; set; } = "legacy";
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

/// <summary>
/// Tag context — products.tags is JSONB on the product row now, so this is
/// kept primarily for the customer/territory tag concept. Empty by default
/// unless a future tagging table is reintroduced.
/// </summary>
public class TagContext
{
    public Dictionary<string, List<string>> ProductTags { get; set; } = new();
    public Dictionary<string, List<string>> CustomerTags { get; set; } = new();
    public Dictionary<string, List<string>> SalesOfficeTags { get; set; } = new();
}

public class PipelineRunRequest
{
    public string PlanUid { get; set; } = "";
    public string Period { get; set; } = "";
    public string? CreatedBy { get; set; }
    public bool IsSimulation { get; set; }
    public Dictionary<string, object?>? Overrides { get; set; }
    public string? EmpUid { get; set; }

    // Dedup: before running, drop any existing draft (approval_status='pending')
    // run + payouts + kpi_results for this (plan, period) so the dashboard sees
    // a single current-state record instead of one row per daily cron pass.
    // Simulations always force this to false (they own their own run rows).
    public bool ReplaceDraft { get; set; } = true;

    // After Step 11, promote payouts pending → submitted and write approval_log.
    // Caller decides based on date (cron: last-day-of-month; manual: today >= last day of period).
    public bool AutoSubmit { get; set; } = false;
}

public class PipelineRunResult
{
    public string RunUid { get; set; } = "";
    public string PlanUid { get; set; } = "";
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
