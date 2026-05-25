namespace Commission.Api.Engine;

/// <summary>Port of server/src/engine/eligibilityEngine.js</summary>
public class EligibilityEngine
{
    public EligibilityResult Check(List<Transaction> transactions, List<EligibilityRule> rules)
    {
        if (rules is null || rules.Count == 0)
            return new EligibilityResult { Status = "eligible", Reduction = 0 };

        var sales        = transactions.Where(t => t.TransactionType == "sale").ToList();
        var returns      = transactions.Where(t => t.TransactionType == "return").ToList();
        var collections  = transactions.Where(t => t.TransactionType == "collection").ToList();

        double totalSales       = sales.Sum(t => t.Amount);
        double totalReturns     = returns.Sum(t => t.Amount);
        double totalCollections = collections.Sum(t => t.Amount);

        var metrics = new Dictionary<string, double>
        {
            ["min_sales"]              = totalSales,
            ["min_collection_percent"] = totalSales > 0 ? (totalCollections / totalSales) * 100 : 0,
            ["max_return_percent"]     = totalSales > 0 ? (totalReturns     / totalSales) * 100 : 0,
            ["min_active_days"]        = 22,   // matches JS default constant
            ["min_lines_sold"]         = sales.Select(t => t.ProductId).Where(p => p != null).Distinct().Count()
        };

        var status = "eligible";
        double reduction = 0;
        var details = new List<Dictionary<string, object?>>();

        foreach (var rule in rules)
        {
            metrics.TryGetValue(rule.Metric, out var metricValue);
            bool passes = rule.Operator switch
            {
                ">=" => metricValue >= rule.Threshold,
                "<=" => metricValue <= rule.Threshold,
                ">"  => metricValue >  rule.Threshold,
                "<"  => metricValue <  rule.Threshold,
                "="  => metricValue == rule.Threshold,
                _ => true
            };

            var detail = new Dictionary<string, object?>
            {
                ["metric"]    = rule.Metric,
                ["operator"]  = rule.Operator,
                ["threshold"] = rule.Threshold,
                ["actual"]    = Math.Round(metricValue * 100) / 100,
                ["passed"]    = passes,
                ["action"]    = rule.Action,
            };

            if (!passes)
            {
                switch (rule.Action)
                {
                    case "zero_payout":
                        status = "ineligible";
                        detail["impact"] = "Payout set to zero";
                        break;
                    case "reduce_percent":
                        if (status != "ineligible") status = "reduced";
                        reduction = Math.Max(reduction, rule.ReductionPercent);
                        detail["impact"] = $"Payout reduced by {rule.ReductionPercent}%";
                        break;
                    case "warning_only":
                        detail["impact"] = "Warning only - no payout impact";
                        break;
                }
            }
            details.Add(detail);
        }

        return new EligibilityResult { Status = status, Reduction = reduction, Details = details };
    }
}
