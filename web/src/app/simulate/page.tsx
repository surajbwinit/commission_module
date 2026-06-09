'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Play, FlaskConical, Sparkles, TrendingUp, TrendingDown, Minus, Loader2, AlertCircle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { formatCurrency, cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import EmptyState from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Pill';
import PageHero from '@/components/layout/PageHero';

interface Plan { uid: string; name: string; status: string; base_payout: number; }

interface RunResult {
  run_uid: string; total_payout: number; employee_count: number;
  payouts: { emp_uid: string; employee_name: string; net_payout: number }[];
}

type Inputs = { basePayout: number; targetMultiplier: number; strategicSkuPct: number };

export default function SimulatePage() {
  const { selectedPeriod } = useAppStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planUid, setPlanUid] = useState('');

  // Inputs (mutated by sliders)
  const [inputs, setInputs] = useState<Inputs>({ basePayout: 15000, targetMultiplier: 100, strategicSkuPct: 20 });
  // Inputs that were used in the LAST successful run
  const [lastRunInputs, setLastRunInputs] = useState<Inputs | null>(null);

  const [baseline, setBaseline] = useState<RunResult | null>(null);
  const [sim, setSim] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);

  // Debounce timer for auto-recalc on slider release
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get<unknown, Plan[]>('/plans').then((all) => {
      const active = all.filter((p) => p.status === 'active');
      setPlans(active);
      if (active.length > 0) {
        setPlanUid(active[0].uid);
      } else {
        setPlanUid('');
      }
    });
  }, []);

  useEffect(() => {
    const p = plans.find((x) => x.uid === planUid);
    if (p) setInputs((x) => ({ ...x, basePayout: p.base_payout || 15000 }));
    setBaseline(null); setSim(null); setLastRunInputs(null);
  }, [planUid, plans]);

  const runBoth = async (i: Inputs = inputs) => {
    if (!planUid) return;
    setRunning(true);
    try {
      const b = await api.post<unknown, RunResult>('/simulation/run', { planUid, period: selectedPeriod });
      setBaseline(b);
      const s = await api.post<unknown, RunResult>('/simulation/run', {
        planUid, period: selectedPeriod,
        overrides: {
          base_payout: i.basePayout,
          multipliers: { strategic_sku_percent: i.strategicSkuPct },
          target_multiplier: i.targetMultiplier,
        },
      });
      setSim(s);
      setLastRunInputs(i);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRunning(false);
    }
  };

  // Has any slider moved since the last successful run?
  const stale = !!lastRunInputs && (
    lastRunInputs.basePayout       !== inputs.basePayout ||
    lastRunInputs.targetMultiplier !== inputs.targetMultiplier ||
    lastRunInputs.strategicSkuPct  !== inputs.strategicSkuPct
  );

  // Queue auto-recalc on slider release (debounced 600ms)
  const scheduleRerun = (next: Inputs) => {
    setInputs(next);
    if (!lastRunInputs) return;          // never run before — wait for explicit click
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { runBoth(next); }, 600);
  };

  // Comparison data
  const compareData = baseline && sim
    ? baseline.payouts.map((b) => {
        const s = sim.payouts.find((x) => x.emp_uid === b.emp_uid);
        return {
          name: b.employee_name.split(' ').slice(0, 2).join(' '),
          baseline: b.net_payout,
          simulation: s?.net_payout ?? 0,
          diff: (s?.net_payout ?? 0) - b.net_payout,
        };
      }).filter((d) => d.baseline > 0 || d.simulation > 0).slice(0, 15)
    : [];

  const totalDiff = baseline && sim ? sim.total_payout - baseline.total_payout : 0;
  const pctChange = baseline && sim && baseline.total_payout > 0 ? (totalDiff / baseline.total_payout) * 100 : 0;
  const affectedCount = baseline && sim
    ? baseline.payouts.filter((b) => {
        const s = sim.payouts.find((x) => x.emp_uid === b.emp_uid);
        return Math.abs((s?.net_payout ?? 0) - b.net_payout) > 0.01;
      }).length
    : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHero
        title="Simulate"
        accessory={<Badge tone="soft"><Sparkles className="w-3 h-3" /> Sandbox</Badge>}
      />

      <section className="rounded-xl border bg-card shadow-sm p-6">
        <div className="grid md:grid-cols-[1fr_auto] gap-4 items-end mb-6">
          <label className="block">
            <span className="label">Plan <span className="font-normal text-muted-foreground">(active only)</span></span>
            <select className="input" value={planUid} onChange={(e) => setPlanUid(e.target.value)} disabled={plans.length === 0}>
              {plans.length === 0
                ? <option>No active plans</option>
                : plans.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            {stale && !running && (
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-2 py-1 rounded">
                <AlertCircle className="h-3 w-3" /> Stale — re-running…
              </span>
            )}
            <button onClick={() => runBoth()} disabled={running || !planUid}
              className={cn('btn-primary btn-lg whitespace-nowrap', stale && !running && 'ring-2 ring-primary/40')}>
              {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Simulating…</>
                       : <><Play className="h-4 w-4" /> {lastRunInputs ? 'Re-run' : 'Run simulation'}</>}
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6 pt-2 border-t">
          <div className="pt-5">
            <Slider
              label="Base payout"
              value={inputs.basePayout}
              min={0} max={50000} step={500}
              onChange={(v) => scheduleRerun({ ...inputs, basePayout: v })}
              format={(v) => formatCurrency(v)}
            />
          </div>
          <div className="pt-5">
            <Slider
              label="Target multiplier"
              value={inputs.targetMultiplier}
              min={50} max={200} step={5}
              onChange={(v) => scheduleRerun({ ...inputs, targetMultiplier: v })}
              format={(v) => `${v}%`}
              hint="Scales every KPI target — lower = easier to hit, higher = harder."
            />
          </div>
          <div className="pt-5">
            <Slider
              label="Strategic SKU % override"
              value={inputs.strategicSkuPct}
              min={0} max={100} step={5}
              onChange={(v) => scheduleRerun({ ...inputs, strategicSkuPct: v })}
              format={(v) => `${v}%`}
              hint="Forces strategic_sku_percent KPI for multiplier rules."
            />
          </div>
        </div>
      </section>

      {/* Budget impact + chart */}
      {baseline && sim ? (
        <div className="grid lg:grid-cols-[360px_1fr] gap-5">
          <ImpactCard baseline={baseline.total_payout} simulation={sim.total_payout} diff={totalDiff} pctChange={pctChange} affected={affectedCount} />
          <ComparisonChart data={compareData} />
        </div>
      ) : !running ? (
        <EmptyState
          icon={FlaskConical}
          title="Run a simulation"
          description="Adjust the sliders and click 'Run simulation' once. After the first run, slider changes will auto-recalculate."
        />
      ) : null}

      {/* Per-employee comparison */}
      {baseline && sim && compareData.length > 0 && (
        <section className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="section-head px-6 pt-5">
            <div>
              <h2>Per-employee comparison</h2>
              <p>Showing top 15 employees where baseline or simulation is non-zero.</p>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground bg-muted/40 border-y">
              <tr>
                <th className="text-left pl-6 px-2 py-2.5 font-semibold">Employee</th>
                <th className="text-right px-2 py-2.5 font-semibold">Baseline</th>
                <th className="text-right px-2 py-2.5 font-semibold">Simulation</th>
                <th className="text-right pl-2 pr-6 py-2.5 font-semibold">Difference</th>
              </tr>
            </thead>
            <tbody>
              {compareData.map((d) => {
                const TrendIcon = d.diff > 0 ? TrendingUp : d.diff < 0 ? TrendingDown : Minus;
                const tone = d.diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : d.diff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground';
                return (
                  <tr key={d.name} className="border-t hover:bg-accent transition-colors">
                    <td className="pl-6 px-2 py-3 font-medium">{d.name}</td>
                    <td className="px-2 py-3 text-right tabular-nums text-muted-foreground">{formatCurrency(d.baseline)}</td>
                    <td className="px-2 py-3 text-right tabular-nums font-medium">{formatCurrency(d.simulation)}</td>
                    <td className={cn('pl-2 pr-6 py-3 text-right font-semibold tabular-nums', tone)}>
                      <span className="inline-flex items-center justify-end gap-1">
                        <TrendIcon className="h-3.5 w-3.5" />
                        {d.diff > 0 ? '+' : ''}{formatCurrency(d.diff)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Slider({
  label, value, min, max, step, onChange, format, hint,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string; hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary cursor-pointer"
      />
      <div className="flex justify-between text-[10.5px] text-muted-foreground mt-1.5 tabular-nums">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
      {hint && <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{hint}</p>}
    </div>
  );
}

function ImpactCard({ baseline, simulation, diff, pctChange, affected }: {
  baseline: number; simulation: number; diff: number; pctChange: number; affected: number;
}) {
  const positive = diff >= 0;
  return (
    <section className="rounded-xl border bg-card shadow-sm p-5">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-4">Budget impact</div>
      <div className="space-y-2.5">
        <Row label="Baseline total"   value={formatCurrency(baseline)}   />
        <Row label="Simulation total" value={formatCurrency(simulation)} emphasis />
        <div className="border-t my-2" />
        <Row label="Difference" value={
          <span className={positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
            {positive ? '+' : ''}{formatCurrency(diff)}
          </span>
        } emphasis />
        <Row label="% change" value={
          <span className={positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
            {positive ? '+' : ''}{pctChange.toFixed(1)}%
          </span>
        } />
        <Row label="Employees affected" value={`${affected}`} />
      </div>
    </section>
  );
}

function Row({ label, value, emphasis }: { label: string; value: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('tabular-nums', emphasis ? 'text-base font-semibold text-foreground' : 'text-sm text-foreground')}>{value}</span>
    </div>
  );
}

function ComparisonChart({ data }: { data: { name: string; baseline: number; simulation: number }[] }) {
  return (
    <section className="rounded-xl border bg-card shadow-sm p-6">
      <div className="section-head">
        <div><h2>Baseline vs simulation</h2><p>Per-employee net payout comparison.</p></div>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-muted-foreground/40" /> Baseline</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-primary" /> Simulation</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 8, right: 0, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} interval={0} angle={-25} textAnchor="end" height={60} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
          <Bar dataKey="baseline"   fill="hsl(var(--muted-foreground) / 0.4)" radius={[6, 6, 0, 0]} />
          <Bar dataKey="simulation" fill="hsl(var(--primary))"                 radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
