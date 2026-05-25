using Commission.Api.Data;
using Commission.Api.Engine;
using Dapper;

namespace Commission.Api.Scheduler;

/// <summary>
/// Hosted background service. Every day at 02:00 (configurable) it:
///   1. Re-runs the calculation pipeline for every ACTIVE MONTHLY plan, for the CURRENT period.
///      Payouts are stored with approval_status='draft' (NOT submitted to approvers).
///   2. If today is the FIRST day of a new month, promotes all 'draft' payouts of the PREVIOUS period
///      to 'submitted' — that kicks off the approval workflow for the closed month.
/// </summary>
public class DailyCronService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<DailyCronService> _log;
    private readonly TimeSpan _runAt;
    private readonly bool _enabled;

    public DailyCronService(IServiceProvider services, IConfiguration config, ILogger<DailyCronService> log)
    {
        _services = services;
        _log = log;
        _enabled = config.GetValue("Cron:Enabled", true);
        var hours = config.GetValue("Cron:HourUtc", 2);
        _runAt = TimeSpan.FromHours(hours);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_enabled)
        {
            _log.LogInformation("Daily cron is disabled (Cron:Enabled=false).");
            return;
        }
        _log.LogInformation("Daily cron service started, configured to fire at {Hour}:00 UTC.", _runAt.Hours);

        // Optional one-shot run on startup (so first deploy doesn't wait till tomorrow)
        try { await RunOnceAsync(stoppingToken); }
        catch (Exception ex) { _log.LogError(ex, "Initial cron run failed (continuing)."); }

        while (!stoppingToken.IsCancellationRequested)
        {
            var now = DateTime.UtcNow;
            var next = now.Date.AddDays(now.TimeOfDay >= _runAt ? 1 : 0).Add(_runAt);
            var delay = next - now;
            _log.LogInformation("Next cron fire scheduled at {Next:u} (in {Delay}).", next, delay);
            try { await Task.Delay(delay, stoppingToken); }
            catch (OperationCanceledException) { break; }
            try { await RunOnceAsync(stoppingToken); }
            catch (Exception ex) { _log.LogError(ex, "Daily cron pass failed."); }
        }
    }

    public async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IDb>();
        var pipeline = scope.ServiceProvider.GetRequiredService<CalculationPipeline>();

        var today = DateTime.UtcNow.Date;
        var period = today.ToString("yyyy-MM");
        var isFirstOfMonth = today.Day == 1;

        // ─── 1. Re-run all active monthly plans for current period (draft) ───
        var activeMonthly = await db.QueryAsync<dynamic>(
            "SELECT id, name FROM commission_plans WHERE status = 'active' AND plan_type = 'monthly'", ct: ct);
        int recalced = 0;
        foreach (var p in activeMonthly)
        {
            try
            {
                _log.LogInformation("Cron: re-running plan {PlanName} for period {Period} (draft)", (string)p.name, period);
                var result = await pipeline.RunAsync(new PipelineRunRequest {
                    PlanId  = (string)p.id,
                    Period  = period,
                    CreatedBy = "cron",
                    IsSimulation = false,
                }, ct);
                // Mark the payouts of THIS run as draft (not 'submitted')
                await db.ExecuteAsync(@"
                    UPDATE employee_payouts SET approval_status = 'draft'
                    WHERE run_id = @r AND approval_status = 'submitted'",
                    new { r = result.RunId }, ct: ct);
                recalced++;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Cron: re-run failed for plan {PlanId}", (string)p.id);
            }
        }
        _log.LogInformation("Cron: re-ran {Count} active monthly plans for {Period}.", recalced, period);

        // ─── 2. Month boundary — promote previous month's drafts to submitted ───
        if (isFirstOfMonth)
        {
            var prev = today.AddMonths(-1).ToString("yyyy-MM");
            var promoted = await db.ExecuteAsync(@"
                UPDATE employee_payouts
                SET approval_status = 'submitted'
                WHERE approval_status = 'draft' AND period = @p", new { p = prev }, ct: ct);
            _log.LogInformation("Cron: promoted {N} payouts from draft → submitted for closed period {Period}.", promoted, prev);

            if (promoted > 0)
            {
                // Audit trail entry
                await db.ExecuteAsync(@"
                    INSERT INTO audit_trail (id, entity_type, entity_id, action, changes, performed_by, performed_at)
                    VALUES (@id, 'payout-batch', @period, 'submitted', @ch, 'cron', NOW())",
                    new {
                        id = Guid.NewGuid().ToString(),
                        period = prev,
                        ch = $"{{\"promoted\": {promoted}, \"trigger\": \"month_end_cron\"}}"
                    }, ct: ct);
            }
        }
    }
}
