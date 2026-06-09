'use client';
import { useEffect, useState } from 'react';
import {
  Play, ChevronDown, ChevronRight, Calculator, CheckCircle2, Clock, Sparkles,
  TrendingUp, AlertTriangle, Shield, Wallet, FlaskConical, Info,
} from 'lucide-react';
import api from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { formatCurrency, formatDateTime, cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { Skeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Pill';
import PageHero from '@/components/layout/PageHero';

const PIPELINE_STEPS = [
  { step: 1,  name: 'Fetch transactions',  info: 'Pulls scoped transactions for each employee in the period.' },
  { step: 2,  name: 'Apply filters',        info: 'Include / exclude rules narrow the transaction set.' },
  { step: 3,  name: 'Eligibility check',    info: 'Verifies min sales, min collection %, etc.' },
  { step: 4,  name: 'KPI achievement',      info: 'For each KPI: compute actual via formula → % of target.' },
  { step: 5,  name: 'Determine pay rate',   info: 'Maps achievement % to the matching slab tier.' },
  { step: 6,  name: 'KPI payout → weight',  info: 'Raw payout → weight = weighted payout per KPI.' },
  { step: 7,  name: 'Aggregate KPIs',       info: 'Sum weighted payouts → gross payout.' },
  { step: 8,  name: 'KPI deductions',       info: 'Bands on monitor KPIs reduce the gross.' },
  { step: 9,  name: 'Bonuses + penalties',  info: 'Multipliers add; penalties subtract.' },
  { step: 10, name: 'Eligibility adjust',   info: 'Apply zero/reduce based on qualifiers.' },
  { step: 11, name: 'Cap + split',          info: 'Apply max payout cap and inter-role splits.' },
  { step: 12, name: 'Persist + approve',    info: 'Save payout rows and create approval entries.' },
];

type RunStatus = 'completed' | 'failed' | 'running' | 'pending' | 'partial' | string;

const RUN_STATUS_STYLES: Record<string, { pill: string; dot: string; label: string }> = {
  completed: { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
               dot: 'bg-emerald-500', label: 'Completed' },
  failed:    { pill: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
               dot: 'bg-rose-500', label: 'Failed' },
  running:   { pill: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
               dot: 'bg-sky-500 animate-pulse', label: 'Running' },
  pending:   { pill: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
               dot: 'bg-amber-500', label: 'Pending' },
  partial:   { pill: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
               dot: 'bg-amber-500', label: 'Partial' },
};

const ELIGIBILITY_STYLES: Record<string, { pill: string; dot: string; label: string }> = {
  eligible:    { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
                 dot: 'bg-emerald-500', label: 'Eligible' },
  reduced:     { pill: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
                 dot: 'bg-amber-500', label: 'Reduced' },
  not_eligible:{ pill: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
                 dot: 'bg-rose-500', label: 'Not eligible' },
  excluded:    { pill: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
                 dot: 'bg-rose-500', label: 'Excluded' },
};

function EligibilityPill({ status }: { status: string }) {
  const key = (status ?? '').toLowerCase().replace(/[\s-]/g, '_');
  const s = ELIGIBILITY_STYLES[key] ?? {
    pill: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600',
    dot: 'bg-slate-400',
    label: status || 'Unknown',
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset', s.pill)}>
      <span className={cn('inline-block w-1.5 h-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

function RunStatusPill({ status }: { status: RunStatus }) {
  const key = (status ?? '').toLowerCase();
  const s = RUN_STATUS_STYLES[key] ?? {
    pill: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600',
    dot: 'bg-slate-400',
    label: status || 'Unknown',
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset', s.pill)}>
      <span className={cn('inline-block w-1.5 h-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

interface Plan { uid: string; name: string; status: string; }
interface RunListRow { uid: string; plan_name: string; period: string; status: string; total_payout: number; employee_count: number; started_time: string; }
interface RunResult {
  run_uid: string; plan_uid: string; period: string; status: string; total_payout: number; employee_count: number;
  payouts: PayoutSummary[];
}
interface PayoutSummary { uid?: string; emp_uid: string; employee_name: string; role_name: string; gross_payout: number; net_payout: number; eligibility_status: string; }
interface DeductionTriggered {
  kpi_uid: string; kpi_code: string; kpi_name: string;
  rule_name: string; metric_type: string; metric_value: number; deduction_percent: number;
}
interface CalcDetails {
  kpi_deduction?: { amount: number; total_percent: number; triggered: DeductionTriggered[] };
  penalty?:       { amount: number; total_penalty_percent: number; triggered: any[] };
  multiplier?:    { amount: number; final_multiplier: number; applied: any[] };
  eligibility?:   { status: string; details: any[]; reduction: number };
  cap?:           { capped: number; adjustment: number };
  kpi_gross_only?: number;
}
interface PayoutDetail {
  uid: string; employee_name: string; role_name: string; period: string;
  gross_payout: number; kpi_deduction_amount: number; fixed_incentive_amount: number;
  multiplier_amount: number; penalty_amount: number; cap_adjustment: number; split_adjustment: number;
  net_payout: number; eligibility_status: string;
  kpi_results?: KpiResultRow[];
  calculation_details?: CalcDetails | string;
}
interface KpiResultRow {
  kpi_uid: string; kpi_name: string; kpi_code: string; kpi_category: string;
  unit?: string;
  target_value: number; actual_value: number; achievement_percent: number;
  slab_rate: number; slab_type: string;
  raw_payout: number; weighted_payout: number; weight: number;
}

function formatKpiValue(value: number, unit?: string): string {
  if (value == null) return '-';
  if (unit === 'percentage') return `${value}%`;
  if (unit === 'currency')   return formatCurrency(value);
  return String(value);
}

export default function CalculatePage() {
  const { selectedPeriod } = useAppStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [asSimulation, setAsSimulation] = useState(false);
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [result, setResult] = useState<RunResult | null>(null);
  const [pastRuns, setPastRuns] = useState<RunListRow[]>([]);
  const [expandedPayout, setExpandedPayout] = useState<string | null>(null);
  const [payoutDetail, setPayoutDetail] = useState<PayoutDetail | null>(null);

  useEffect(() => {
    Promise.all([api.get<unknown, Plan[]>('/plans'), api.get<unknown, RunListRow[]>('/calculation/runs')])
      .then(([p, r]) => {
        const active = p.filter((x) => x.status === 'active');
        setPlans(active);
        if (active.length > 0) setSelectedPlan(active[0].uid);
        else setSelectedPlan('');
        setPastRuns(r);
      })
      .catch(() => {});
  }, []);

  const run = async () => {
    if (!selectedPlan) { toast.error('Pick a plan first'); return; }
    setRunning(true);
    setResult(null);
    setExpandedPayout(null);
    setPayoutDetail(null);
    setCurrentStep(0);

    const anim = setInterval(() => {
      setCurrentStep((p) => {
        if (p >= PIPELINE_STEPS.length - 1) { clearInterval(anim); return p; }
        return p + 1;
      });
    }, 250);

    try {
      const endpoint = asSimulation ? '/simulation/run' : '/calculation/run';
      const res = await api.post<unknown, RunResult>(endpoint, {
        planUid: selectedPlan, period: selectedPeriod, createdBy: 'ui',
      });
      clearInterval(anim);
      setCurrentStep(PIPELINE_STEPS.length - 1);
      setResult(res);
      toast.success(`${asSimulation ? 'Simulated' : 'Calculated'} → ${res.employee_count} employees, total ${formatCurrency(res.total_payout)}`);
      if (!asSimulation) {
        const runs = await api.get<unknown, RunListRow[]>('/calculation/runs');
        setPastRuns(runs);
      }
    } catch (e: any) {
      clearInterval(anim);
      toast.error(e.message);
    } finally {
      setRunning(false);
    }
  };

  const loadDetail = async (payoutId: string) => {
    if (expandedPayout === payoutId) { setExpandedPayout(null); setPayoutDetail(null); return; }
    setExpandedPayout(payoutId);
    setPayoutDetail(null);
    try {
      const d = await api.get<unknown, PayoutDetail>(`/calculation/payouts/${payoutId}`);
      setPayoutDetail(d);
    } catch (e: any) { toast.error(e.message); }
  };

  // Load a past run into the same UI we use after a fresh run, so you can
  // browse historical calculations and drill into each employee + KPI.
  const loadPastRun = async (runUid: string) => {
    setExpandedPayout(null);
    setPayoutDetail(null);
    try {
      const run = await api.get<unknown, RunResult>(`/calculation/runs/${runUid}`);
      setResult(run);
      setCurrentStep(PIPELINE_STEPS.length - 1);
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHero title="Run Payout" />

      <section className="card p-5">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <label>
            <span className="label">Plan <span className="text-fg-subtle normal-case">(active only)</span></span>
            <select className="input" value={selectedPlan} onChange={(e) => setSelectedPlan(e.target.value)} disabled={plans.length === 0}>
              {plans.length === 0
                ? <option>→ No active plans → activate one in Plans →</option>
                : plans.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Period</span>
            <input className="input bg-sunken" readOnly value={selectedPeriod} />
          </label>
          <button onClick={run} disabled={running || !selectedPlan} className="btn-primary btn-lg whitespace-nowrap">
            {running ? <><Clock className="w-4 h-4 animate-spin" /> Running…</> : <><Play className="w-4 h-4" /> Run</>}
          </button>
        </div>
        <label className="mt-3 inline-flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
          <input type="checkbox" className="rounded" checked={asSimulation} onChange={(e) => setAsSimulation(e.target.checked)} />
          <FlaskConical className={cn('w-4 h-4', asSimulation ? 'text-purple-600' : 'text-fg-subtle')} />
          Save as simulation (no approval entries created)
        </label>
      </section>

      {(running || result) && <PipelineSteps currentStep={currentStep} done={!!result} />}

      {result && (
        <>
          <SummaryCards result={result} />
          <PayoutTable
            payouts={result.payouts}
            expanded={expandedPayout}
            detail={payoutDetail}
            onToggle={loadDetail}
          />
        </>
      )}

      {!running && !result && (
        <section className="card overflow-hidden">
          <div className="section-head px-5 pt-5">
            <div><h2>Recent runs</h2><p>Click to load a previous calculation.</p></div>
            <Badge tone="soft">{pastRuns.length}</Badge>
          </div>
          {pastRuns.length === 0 ? (
            <div className="px-5 pb-8 text-center text-sm text-fg-muted">No runs yet → run a calculation to see results here.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wider text-fg-subtle bg-sunken/60">
                <tr>
                  <th className="text-left pl-5 px-2 py-2.5">Plan</th>
                  <th className="text-left px-2 py-2.5">Period</th>
                  <th className="text-left px-2 py-2.5">Started</th>
                  <th className="text-left px-2 py-2.5">Status</th>
                  <th className="text-right px-2 py-2.5">Employees</th>
                  <th className="text-right pl-2 pr-5 py-2.5">Total</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {pastRuns.slice(0, 12).map((r) => (
                  <tr
                    key={r.uid}
                    onClick={() => loadPastRun(r.uid)}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer dark:border-slate-800 dark:hover:bg-slate-800/40"
                    title="Click to load this run and drill into each employee's KPI breakdown"
                  >
                    <td className="pl-5 px-2 py-2 font-medium">{r.plan_name}</td>
                    <td className="px-2 py-2 font-mono text-2xs text-slate-500">{r.period}</td>
                    <td className="px-2 py-2 text-slate-500">{formatDateTime(r.started_time)}</td>
                    <td className="px-2 py-2">
                      <RunStatusPill status={r.status} />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.employee_count}</td>
                    <td className="pl-2 pr-5 py-2 text-right font-semibold tabular-nums">{formatCurrency(r.total_payout)}</td>
                    <td className="pr-5"><ChevronRight className="w-4 h-4 text-fg-subtle" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

function PipelineSteps({ currentStep, done }: { currentStep: number; done: boolean }) {
  const progressPct = done ? 100 : ((currentStep + 1) / PIPELINE_STEPS.length) * 100;
  return (
    <section className="rounded-xl border bg-card shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2 tracking-tight">
            Calculation pipeline
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">12 steps · running per employee</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {done ? PIPELINE_STEPS.length : Math.min(currentStep + 1, PIPELINE_STEPS.length)} / {PIPELINE_STEPS.length}
          </span>
          {done && <Badge tone="success"><CheckCircle2 className="w-3 h-3" /> Complete</Badge>}
        </div>
      </div>

      {/* Progress rail */}
      <div className="relative h-1.5 bg-muted rounded-full overflow-hidden mb-4">
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Step list — readable, with names visible */}
      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {PIPELINE_STEPS.map((s, i) => {
          const stateDone    = i < currentStep || done;
          const stateCurrent = !done && i === currentStep;
          return (
            <li
              key={s.step}
              title={s.info}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md border text-sm transition-colors',
                stateDone    && 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300',
                stateCurrent && 'bg-primary/10 border-primary/40 text-foreground animate-pulse-soft',
                !stateDone && !stateCurrent && 'bg-muted/30 border-border text-muted-foreground'
              )}
            >
              <span className={cn(
                'inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-semibold tabular-nums shrink-0',
                stateDone    && 'bg-emerald-500 text-white',
                stateCurrent && 'bg-primary text-primary-foreground',
                !stateDone && !stateCurrent && 'bg-background border text-muted-foreground'
              )}>
                {stateDone ? <CheckCircle2 className="h-3 w-3" /> : s.step}
              </span>
              <span className="truncate font-medium">{s.name}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SummaryCards({ result }: { result: RunResult }) {
  const avg = result.employee_count > 0 ? result.total_payout / result.employee_count : 0;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="stat-card">
        <div className="label">Total payout</div>
        <div className="text-2xl font-semibold tabular-nums mt-1">{formatCurrency(result.total_payout)}</div>
      </div>
      <div className="stat-card">
        <div className="label">Employees paid</div>
        <div className="text-2xl font-semibold tabular-nums mt-1">{result.employee_count}</div>
      </div>
      <div className="stat-card">
        <div className="label">Average payout</div>
        <div className="text-2xl font-semibold tabular-nums mt-1">{formatCurrency(avg)}</div>
      </div>
      <div className="stat-card">
        <div className="label">Status</div>
        <div className="mt-1.5"><RunStatusPill status={result.status} /></div>
      </div>
    </div>
  );
}

function PayoutTable({
  payouts, expanded, detail, onToggle,
}: { payouts: PayoutSummary[]; expanded: string | null; detail: PayoutDetail | null; onToggle: (id: string) => void; }) {
  // Highest earners at the top — same order the dashboard leaderboard uses.
  const sortedPayouts = [...payouts].sort((a, b) => (b.net_payout ?? 0) - (a.net_payout ?? 0));
  return (
    <section className="card overflow-hidden">
      <div className="section-head px-5 pt-5">
        <div><h2>Employee payouts</h2><p>Sorted by net payout, highest first. Click a row to see the per-KPI breakdown.</p></div>
        <Badge tone="soft">{sortedPayouts.length} rows</Badge>
      </div>
      <table className="w-full text-sm">
        <thead className="text-2xs uppercase tracking-wider text-fg-subtle bg-sunken/60">
          <tr>
            <th className="w-8"></th>
            <th className="text-left px-2 py-2.5">Employee</th>
            <th className="text-left px-2 py-2.5">Role</th>
            <th className="text-right px-2 py-2.5">Gross</th>
            <th className="text-right px-2 py-2.5">Net</th>
            <th className="text-left px-2 py-2.5">Eligibility</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {sortedPayouts.map((p) => {
            const uid = p.uid ?? p.emp_uid;
            const isExpanded = expanded === uid;
            return (
              <React.Fragment key={uid}>
                <tr className={cn('border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40 cursor-pointer', isExpanded && 'bg-primary-50/40 dark:bg-primary-900/10')} onClick={() => onToggle(uid)}>
                  <td className="pl-5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-300 to-primary-600 text-white text-xs font-semibold flex items-center justify-center">
                      {p.employee_name.charAt(0)}
                    </div>
                  </td>
                  <td className="px-2 py-3 font-medium">{p.employee_name}</td>
                  <td className="px-2 py-3 text-fg-muted">{p.role_name}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{formatCurrency(p.gross_payout)}</td>
                  <td className="px-2 py-3 text-right font-semibold tabular-nums">{formatCurrency(p.net_payout)}</td>
                  <td className="px-2 py-3">
                    <EligibilityPill status={p.eligibility_status} />
                  </td>
                  <td className="pr-5">{isExpanded ? <ChevronDown className="w-4 h-4 text-fg-subtle" /> : <ChevronRight className="w-4 h-4 text-fg-subtle" />}</td>
                </tr>
                {isExpanded && (
                  <tr className="bg-gradient-to-b from-primary-50/30 to-transparent">
                    <td colSpan={7} className="px-5 py-4">
                      {detail ? <PayoutDetailPanel detail={detail} /> : <Skeleton className="h-32" />}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function PayoutDetailPanel({ detail }: { detail: PayoutDetail }) {
  // calculation_details may arrive as a JSON string or a parsed object
  const calc: CalcDetails | undefined = typeof detail.calculation_details === 'string'
    ? safeParseCalc(detail.calculation_details)
    : detail.calculation_details;
  const dedTriggers = calc?.kpi_deduction?.triggered ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <AdjustCard icon={Wallet}        label="Gross"          value={detail.gross_payout}        tone="violet"  />
        <AdjustCard icon={AlertTriangle} label="KPI deductions" value={-detail.kpi_deduction_amount} tone="rose"    />
        <AdjustCard icon={Sparkles}      label="Bonuses"        value={detail.multiplier_amount + detail.fixed_incentive_amount}    tone="emerald" />
        <AdjustCard icon={Shield}        label="Penalties"      value={-detail.penalty_amount}     tone="rose"    />
        <AdjustCard icon={TrendingUp}    label="Cap adjust"     value={-detail.cap_adjustment}     tone="amber"   />
        <AdjustCard icon={CheckCircle2}  label="Net payout"     value={detail.net_payout}          tone="sky"     emphasis />
      </div>

      {/* Why was there a deduction? — show every triggered KPI band */}
      {dedTriggers.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50/40 dark:border-rose-500/30 dark:bg-rose-500/10 p-4">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-rose-800 dark:text-rose-300 mb-2">
            <AlertTriangle className="w-4 h-4" />
            Deduction breakdown — {detail.kpi_deduction_amount.toFixed(2)} total ({calc?.kpi_deduction?.total_percent}% off gross)
          </div>
          <ul className="space-y-1.5 text-sm">
            {dedTriggers.map((t) => (
              <li key={t.kpi_uid} className="flex items-start gap-2">
                <span className="inline-block mt-1 w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                <div className="flex-1">
                  <span className="font-medium text-rose-800 dark:text-rose-200">{t.kpi_name}</span>
                  <span className="text-rose-700/80 dark:text-rose-300/80">
                    {' '}— {t.metric_type === 'actual_value' ? 'actual value' : t.metric_type} is{' '}
                    <span className="font-mono">{t.metric_value}</span>
                    {' '}→ matches band "{t.rule_name}" →{' '}
                    <span className="font-semibold text-rose-700 dark:text-rose-200">−{t.deduction_percent}%</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-fg mb-2 flex items-center gap-1.5">
          <Info className="w-4 h-4 text-fg-subtle" /> KPI-wise breakdown
        </h3>
        <table className="w-full text-sm bg-surface rounded-lg border border-line overflow-hidden">
          <thead className="text-2xs uppercase tracking-wider text-fg-subtle bg-sunken">
            <tr>
              <th className="text-left px-3 py-2">KPI</th>
              <th className="text-right px-3 py-2">Result</th>
              <th className="text-right px-3 py-2">Rate / 1%</th>
              <th className="text-right px-3 py-2">Weight</th>
              <th className="text-right px-3 py-2">Payout</th>
              <th className="text-right px-3 py-2">Deduction</th>
            </tr>
          </thead>
          <tbody>
            {(detail.kpi_results ?? []).map((k) => {
              const pct = k.achievement_percent ?? 0;
              const barColor = pct >= 100 ? 'bg-emerald-400' : pct >= 85 ? 'bg-sky-400' : pct >= 70 ? 'bg-amber-400' : 'bg-rose-400';
              const trig = dedTriggers.find((t) => t.kpi_uid === k.kpi_uid);
              const isMonitor = (k.weight ?? 0) === 0;
              return (
                <tr key={k.kpi_uid} className={cn('border-t border-slate-100 dark:border-slate-800', trig && 'bg-rose-50/30 dark:bg-rose-500/5')}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{k.kpi_name}</div>
                    <div className="text-2xs font-mono text-fg-subtle flex items-center gap-1">
                      {k.kpi_code}
                      {isMonitor && <span className="ml-1 px-1 py-px text-[9px] rounded bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">monitor</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <span className="tabular-nums font-medium">{formatKpiValue(k.actual_value, k.unit)}</span>
                      <div className="w-16 h-1.5 bg-sunken rounded-full overflow-hidden">
                        <div className={cn('h-full', barColor)} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                    {/* Hide rate for monitor KPIs (weight=0) — engine emits a
                        "linear" fallback rate that doesn't drive payout there. */}
                    {isMonitor || k.slab_rate <= 0 || k.slab_type === 'linear'
                      ? <span className="text-fg-subtle">—</span>
                      : k.slab_rate}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{k.weight}%</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {isMonitor ? <span className="text-fg-subtle">—</span> : formatCurrency(k.weighted_payout)}
                  </td>
                  <td className="px-3 py-2 text-right align-top min-w-[180px]">
                    {trig ? (
                      <div className="flex flex-col items-end leading-tight gap-0.5">
                        <span className="font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                          −{formatCurrency(detail.gross_payout * (trig.deduction_percent / 100))}
                        </span>
                        <span className="text-2xs text-rose-600/70 dark:text-rose-300/70">
                          −{trig.deduction_percent}%
                        </span>
                        <span className="text-2xs text-rose-600/70 dark:text-rose-300/70 break-words">
                          {trig.rule_name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-2xs text-fg-subtle">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {(!detail.kpi_results || detail.kpi_results.length === 0) && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-sm text-fg-subtle">No KPI results recorded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdjustCard({ icon: Icon, label, value, tone, emphasis }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: number;
  tone: 'violet' | 'emerald' | 'rose' | 'amber' | 'sky'; emphasis?: boolean;
}) {
  const TONE = {
    violet:  { bg: 'bg-violet-50',  text: 'text-violet-700' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-700' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700' },
    sky:     { bg: 'bg-sky-50',     text: 'text-sky-700' },
  }[tone];
  const sign = value < 0 ? '−' : value > 0 ? '+' : '';
  const abs = Math.abs(value);
  return (
    <div className={cn('rounded-xl p-3 bg-surface border', emphasis ? 'border-primary-300 ring-2 ring-primary-200/40 shadow-card' : 'border-line')}>
      <div className={cn('inline-flex items-center justify-center w-7 h-7 rounded-lg', TONE.bg, TONE.text)}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="text-2xs uppercase tracking-wider text-fg-muted mt-2">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums', emphasis ? 'text-fg' : value < 0 ? 'text-rose-700' : value > 0 ? 'text-emerald-700' : 'text-fg')}>
        {sign}{formatCurrency(abs)}
      </div>
    </div>
  );
}

function safeParseCalc(s: string): CalcDetails | undefined {
  try { return JSON.parse(s); } catch { return undefined; }
}

// React.Fragment is used inside PayoutTable
import React from 'react';
