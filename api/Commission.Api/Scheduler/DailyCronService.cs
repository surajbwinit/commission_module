using Commission.Api.Data;
using Commission.Api.Engine;
using Dapper;

namespace Commission.Api.Scheduler;

/// <summary>
/// Daily background pass:
///   1. Re-run pipeline for every ACTIVE MONTHLY plan, CURRENT period. The pipeline
///      itself dedups the prior day's draft (one calculation_runs + employee_payouts
///      record per plan/period, refreshed in place) so the dashboard never sees
///      duplicate counts.
///   2. On the LAST day of the month, that refresh also auto-submits payouts to
///      approval (AutoSubmit=true). Other days leave them as 'pending' drafts.
///   3. On the 1st of the next month a safety-net sweep promotes any drafts from
///      the previous period that weren't already submitted (e.g., if the last-day
///      cron pass was missed).
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

        // No startup run — every API restart was kicking off a full pass against
        // every active plan, leaving 'running' rows when restarted mid-pass.
        // The scheduled fire below is the only entry point now.

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

        // Sweep stuck 'running' rows from a prior crashed/restarted pass so
        // the UI doesn't accumulate dead rows forever. Anything still 'running'
        // and older than 30 min is marked failed (its partial payouts stay).
        await db.ExecuteAsync(@"
            UPDATE calculation_runs
            SET status = 'failed',
                completed_time = NOW(),
                modified_time  = NOW()
            WHERE status = 'running'
              AND started_time < NOW() - INTERVAL '30 minutes'", ct: ct);

        var today = DateTime.UtcNow.Date;
        var period = today.ToString("yyyy-MM");
        var isFirstOfMonth = today.Day == 1;
        var isLastDayOfMonth = today.Day == DateTime.DaysInMonth(today.Year, today.Month);

        // ─── 1. Refresh all active monthly plans for the current period ───
        //   • Pipeline dedups the prior draft for this (plan, period) before
        //     running, so there is one row per (plan, period, employee) — not
        //     one per daily pass.
        //   • AutoSubmit=true on the last day of the month: this refresh becomes
        //     the official monthly run and its payouts go straight to approval.
        //   • Other days: payouts stay as 'pending' (visible in dashboard /
        //     simulate previews but NOT in the approval queue).
        var activeMonthly = await db.QueryAsync<dynamic>(
            "SELECT uid, name FROM commission_plans WHERE status = 'active' AND plan_type = 'monthly'", ct: ct);
        int recalced = 0;
        foreach (var p in activeMonthly)
        {
            try
            {
                _log.LogInformation(
                    "Cron: refreshing plan {PlanName} for period {Period} (autoSubmit={AutoSubmit})",
                    (string)p.name, period, isLastDayOfMonth);
                await pipeline.RunAsync(new PipelineRunRequest {
                    PlanUid = (string)p.uid,
                    Period  = period,
                    CreatedBy = "cron",
                    IsSimulation = false,
                    ReplaceDraft = true,
                    AutoSubmit = isLastDayOfMonth,
                }, ct);
                recalced++;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Cron: refresh failed for plan {PlanUid}", (string)p.uid);
            }
        }
        _log.LogInformation(
            "Cron: refreshed {Count} active monthly plans for {Period} (autoSubmit={AutoSubmit}).",
            recalced, period, isLastDayOfMonth);

        // ─── 2. Safety net: day-1-of-next-month catches any drafts the last-day ───
        //   pass missed (e.g., API down on the last day, or a plan that was
        //   activated mid-month after the last-day window). Idempotent — if
        //   everything was already submitted by the last-day pass, this is a no-op.
        if (isFirstOfMonth)
        {
            var prev = today.AddMonths(-1).ToString("yyyy-MM");

            // Collect the payouts we're about to promote so we can also stamp
            // approval_log rows (the primary last-day path does this via
            // Steps.CreateApprovalAsync inside the pipeline; the safety net
            // must match so approval history is consistent).
            var draftPayouts = (await db.QueryAsync<string>(@"
                SELECT uid FROM employee_payouts
                WHERE approval_status = 'pending' AND period = @p", new { p = prev }, ct: ct)).ToList();

            if (draftPayouts.Count > 0)
            {
                await db.ExecuteAsync(@"
                    UPDATE employee_payouts
                    SET approval_status = 'submitted', modified_time = NOW()
                    WHERE approval_status = 'pending' AND period = @p", new { p = prev }, ct: ct);

                foreach (var payoutUid in draftPayouts)
                {
                    await db.ExecuteAsync(@"
                        INSERT INTO approval_log (uid, payout_uid, action, acted_by, acted_by_role, comments, source_system)
                        VALUES (@uid, @pid, 'submitted', 'cron', 'system', 'Auto-submitted by day-1 safety-net sweep', 'cron')",
                        new { uid = Guid.NewGuid().ToString(), pid = payoutUid }, ct: ct);
                }

                await db.ExecuteAsync(@"
                    INSERT INTO audit_trail (uid, entity_type, entity_uid, action, changes, performed_by, source_system)
                    VALUES (@uid, 'payout-batch', @period, 'submitted', @ch::jsonb, 'cron', 'cron')",
                    new {
                        uid = Guid.NewGuid().ToString(),
                        period = prev,
                        ch = $"{{\"promoted\": {draftPayouts.Count}, \"trigger\": \"day1_safety_net\"}}"
                    }, ct: ct);
            }
            _log.LogInformation(
                "Cron: safety-net promoted {N} payouts from pending → submitted for closed period {Period}.",
                draftPayouts.Count, prev);
        }
    }
}
