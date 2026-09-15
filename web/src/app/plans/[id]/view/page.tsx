'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Calculator, Target, Info, Calendar, Users, Building2,
} from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import PageHero from '@/components/layout/PageHero';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

// ---------------------------------------------------------------------------
// Types (mirrors the shape returned by GET /plans/{uid})
// ---------------------------------------------------------------------------
interface SlabTier {
  min_percent: number;
  max_percent: number | null;
  rate: number;
  rate_type: 'percentage' | 'fixed' | 'per_unit' | 'per_achievement_point';
  min_inclusive?: number | boolean;
  max_inclusive?: number | boolean;
}
interface SlabSet {
  uid: string; name: string; type: string; kpi_uid: string;
  role_uid: string | null; role_name?: string | null; tiers: SlabTier[];
}
interface PlanKpi {
  uid: string; kpi_uid: string; kpi_name: string; kpi_code: string; kpi_category?: string;
  weight: number; target_value: number; slab_set_uid: string | null;
  direction?: string; unit?: string;
}
interface DeductionRule {
  uid: string; kpi_uid: string; kpi_name?: string; kpi_code?: string; role_uid: string | null; role_name?: string | null;
  metric_type: 'shortfall_percent' | 'achievement_percent' | 'actual_value';
  min_value: number | null; max_value: number | null;
  min_inclusive: boolean; max_inclusive: boolean;
  deduction_percent: number; priority: number; name?: string;
}
interface Plan {
  uid: string; name: string; description?: string;
  status: string; plan_type: string;
  effective_from: string; effective_to: string;
  base_payout: number; currency_code?: string; currency_symbol?: string;
  roles?: { uid: string; role_name_en?: string; name?: string; role_code?: string }[];
  sales_offices?: { uid: string; name?: string; code?: string }[];
  employees?: { uid: string; name: string }[];
  kpis?: PlanKpi[];
  slab_sets?: SlabSet[];
  kpi_deduction_rules?: DeductionRule[];
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------
const STATUS_STYLES: Record<string, { pill: string; dot: string; label: string }> = {
  active:   { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30', dot: 'bg-emerald-500', label: 'Active' },
  draft:    { pill: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',             dot: 'bg-amber-500',   label: 'Draft' },
  expired:  { pill: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600',               dot: 'bg-slate-400',   label: 'Expired' },
  archived: { pill: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',                   dot: 'bg-rose-500',    label: 'Archived' },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset', s.pill)}>
      <span className={cn('inline-block w-1.5 h-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

const rateTypeLabel = (t: SlabTier['rate_type']) => {
  switch (t) {
    case 'percentage':            return '% of base';
    case 'fixed':                 return 'fixed';
    case 'per_unit':              return 'per unit';
    case 'per_achievement_point': return 'per 1%';
    default:                      return t;
  }
};
const metricTypeLabel = (t: DeductionRule['metric_type']) => {
  switch (t) {
    case 'achievement_percent': return 'Achievement %';
    case 'shortfall_percent':   return 'Shortfall %';
    default:                    return 'Actual value';
  }
};
const directionLabel = (d?: string) => (d === 'lower_is_better' ? 'Lower is better' : 'Higher is better');

const fmtNum = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v);

const fmtRate = (t: SlabTier, currency?: string) =>
  t.rate_type === 'percentage' ? `${fmtNum(t.rate)}%` : formatCurrency(t.rate, currency);

/** "80% → 100%" / "100% → ∞" range text for a slab tier. */
const tierRange = (t: SlabTier) =>
  `${fmtNum(t.min_percent)}% → ${t.max_percent == null ? '∞' : `${fmtNum(t.max_percent)}%`}`;

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 min-w-0 px-4 py-3 rounded-lg border border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="h-9 w-9 shrink-0 rounded-md bg-white text-slate-500 border border-slate-200 flex items-center justify-center dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</div>
        <div className="text-sm font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap tabular-nums">{value}</div>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, right }: {
  icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string; right?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {right}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Read-only slab ladder — "sales achievement → pay rate"
// ---------------------------------------------------------------------------
function AchievementLadder({ tiers, currency }: { tiers: SlabTier[]; currency?: string }) {
  const SCALE_MAX = 200;
  const pct = (v: number) => Math.min(100, (v / SCALE_MAX) * 100);

  if (tiers.length === 0) {
    return <div className="text-xs text-slate-500 italic">No pay-rate tiers configured for this KPI.</div>;
  }

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
        Achievement (% of target)
        <span className="ml-auto">Pay rate</span>
      </div>

      {/* Scale ruler */}
      <div className="relative h-4 ml-24 mr-40 border-b border-slate-200 dark:border-slate-700">
        {[0, 50, 100, 150, 200].map((m) => (
          <div key={m} className="absolute -bottom-1 -translate-x-1/2 text-[10px] text-slate-400" style={{ left: `${pct(m)}%` }}>
            {m}%
            <div className="h-1 w-px bg-slate-200 mx-auto dark:bg-slate-700" />
          </div>
        ))}
      </div>

      <div className="space-y-1">
        {tiers.map((t, idx) => {
          const left = pct(t.min_percent);
          const right = pct(t.max_percent ?? SCALE_MAX);
          const open = t.max_percent == null;
          return (
            <div key={idx} className="flex items-center gap-2">
              <div className="w-24 shrink-0 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 truncate">{tierRange(t)}</div>
              <div className="flex-1 relative h-5">
                <div className="absolute inset-0 bg-slate-100 rounded dark:bg-slate-800" />
                <div
                  className={cn('absolute inset-y-0 rounded', open ? 'bg-gradient-to-r from-emerald-300 to-emerald-100' : 'bg-emerald-300')}
                  style={{ left: `${left}%`, right: `${100 - right}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-[11px] text-emerald-900 font-medium">
                  Tier {idx + 1}
                </div>
              </div>
              <div className="w-40 shrink-0 text-xs text-right truncate">
                <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{fmtRate(t, currency)}</span>
                <span className="ml-1 text-slate-500">{rateTypeLabel(t.rate_type)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only deduction bands — compact card body (no tables, no horizontal
// scroll) so several KPIs can sit side by side in a 3-column grid.
// ---------------------------------------------------------------------------
function DeductionBandsView({ bands }: { bands: DeductionRule[] }) {
  if (bands.length === 0) {
    return <div className="text-xs text-slate-500 italic">No deduction bands configured.</div>;
  }
  const maxValue = Math.max(20, ...bands.flatMap((b) => [b.min_value ?? 0, b.max_value ?? 0]));
  const pct = (v: number) => Math.min(100, (v / maxValue) * 100);
  const metricTypes = Array.from(new Set(bands.map((b) => b.metric_type)));
  const uniformMetric = metricTypes.length === 1 ? metricTypes[0] : null;
  const roles = Array.from(new Set(bands.map((b) => b.role_name).filter(Boolean)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-slate-400">
        <span>Range</span>
        <span>Deduction</span>
      </div>

      <div className="space-y-1.5">
        {bands.map((b, idx) => {
          const left = pct(b.min_value ?? 0);
          const right = pct(b.max_value ?? maxValue);
          const intensity = b.deduction_percent >= 20 ? 'bg-rose-400' : 'bg-rose-300';
          const range = `${fmtNum(b.min_value)} → ${b.max_value == null ? '∞' : fmtNum(b.max_value)}`;
          return (
            <div key={b.uid ?? idx} className="min-w-0" title={b.name || undefined}>
              <div className="flex items-center gap-2">
                <div className="w-[5.5rem] shrink-0 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 truncate">{range}</div>
                <div className="flex-1 relative h-2 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className={cn('absolute inset-y-0 rounded', intensity)} style={{ left: `${left}%`, right: `${100 - right}%` }} />
                </div>
                <div className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                  −{fmtNum(b.deduction_percent)}%
                </div>
              </div>
              {!uniformMetric && (
                <div className="pl-[5.5rem] ml-2 text-[10px] text-slate-400">{metricTypeLabel(b.metric_type)}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        {uniformMetric && <span className="badge badge-neutral text-[10px]">On {metricTypeLabel(uniformMetric)}</span>}
        {roles.length > 0
          ? roles.map((r) => <span key={r as string} className="badge badge-neutral text-[10px]">Role: {r}</span>)
          : <span className="badge badge-neutral text-[10px]">All roles</span>}
      </div>
    </div>
  );
}

/** One monitor KPI with its deduction bands, sized for a 3-column grid. */
function DeductionKpiCard({ title, code, subtitle, target, bands }: {
  title: string; code?: string; subtitle?: string; target?: React.ReactNode; bands: DeductionRule[];
}) {
  return (
    <div className="min-w-0 flex flex-col border border-slate-200 rounded-lg p-4 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate" title={title}>{title}</div>
          {(code || subtitle) && (
            <div className="text-xs text-slate-500 font-mono truncate">
              {code}{code && subtitle ? ' · ' : ''}{subtitle}
            </div>
          )}
        </div>
        {target != null && <span className="badge badge-neutral text-[10px] shrink-0">{target}</span>}
      </div>
      <DeductionBandsView bands={bands} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function PlanViewPage() {
  const params = useParams<{ id: string }>();
  const uid = params?.id;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const setCrumbLabel = useAppStore((s) => s.setCrumbLabel);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    api.get<unknown, Plan>(`/plans/${uid}`)
      .then(setPlan)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [uid]);

  // Breadcrumb: Plans / <plan name> / View
  useEffect(() => {
    if (!uid) return;
    const base = `/plans/${encodeURIComponent(uid)}`;
    if (plan?.name) setCrumbLabel(base, plan.name);
    setCrumbLabel(`${base}/view`, 'View');
  }, [uid, plan?.name, setCrumbLabel]);

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="space-y-2">
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
          <div className="h-8 w-72 bg-muted rounded animate-pulse" />
        </div>
        {[0, 1, 2].map((i) => <div key={i} className="h-44 w-full bg-muted rounded-xl animate-pulse" />)}
      </div>
    );
  }
  if (!plan) return <div className="text-sm text-muted-foreground">Plan not found.</div>;

  const kpis = plan.kpis ?? [];
  const payoutKpis = kpis.filter((k) => Number(k.weight) > 0);
  const monitorKpis = kpis.filter((k) => Number(k.weight) === 0);
  const totalWeight = payoutKpis.reduce((s, k) => s + (Number(k.weight) || 0), 0);
  const slabFor = (kpiUid: string) => (plan.slab_sets ?? []).find((s) => s.kpi_uid === kpiUid);
  const dedsFor = (kpiUid: string) => (plan.kpi_deduction_rules ?? []).filter((d) => d.kpi_uid === kpiUid);
  const otherDeductions = (plan.kpi_deduction_rules ?? []).filter((d) => !monitorKpis.some((k) => k.kpi_uid === d.kpi_uid));
  const roleName = (r: NonNullable<Plan['roles']>[number]) => r.role_name_en ?? r.name ?? r.role_code ?? r.uid;
  const officeName = (o: NonNullable<Plan['sales_offices']>[number]) => o.name ?? o.code ?? o.uid;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHero
        title={plan.name || 'Plan'}
        subtitle={plan.description}
        accessory={
          <div className="flex items-center gap-2">
            <Link href="/plans" className="btn-ghost btn-sm"><ArrowLeft className="h-3.5 w-3.5" /> All plans</Link>
            <StatusPill status={plan.status} />
            <span className="badge badge-neutral">View only</span>
          </div>
        }
      />

      {/* 1. Overview — single compact row */}
      <section className="card px-5 py-4">
        <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
          <Stat icon={Info} label="Type" value={<span className="capitalize">{plan.plan_type || '—'}</span>} />
          <Stat icon={Calendar} label="Effective" value={`${formatDate(plan.effective_from)} → ${formatDate(plan.effective_to)}`} />
          <Stat icon={Target} label="KPIs" value={`${payoutKpis.length} payout · ${monitorKpis.length} monitor`} />
          {plan.employees && plan.employees.length > 0 && (
            <Stat icon={Users} label="Employees" value={`${plan.employees.length} attached`} />
          )}
        </div>

        {((plan.roles?.length ?? 0) > 0 || (plan.sales_offices?.length ?? 0) > 0) && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            {(plan.roles?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-slate-500 mr-1"><Users className="h-3.5 w-3.5" /> Roles</span>
                {plan.roles!.map((r) => <span key={r.uid} className="badge badge-info text-[11px]">{roleName(r)}</span>)}
              </div>
            )}
            {(plan.sales_offices?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-slate-500 mr-1"><Building2 className="h-3.5 w-3.5" /> Sales offices</span>
                {plan.sales_offices!.map((o) => <span key={o.uid} className="badge badge-neutral text-[11px]">{officeName(o)}</span>)}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. KPIs & Weights — one card per payout KPI: weight/target header + achievement ladder */}
      <section className="card p-5">
        <SectionHeader
          icon={Calculator}
          title="KPIs & Weights"
          subtitle="Payout metrics with their weights and pay-rate ladder, plus monitor metrics with their deduction bands."
          right={
            <div className={cn('shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ring-1 ring-inset',
              totalWeight === 100 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' :
              totalWeight === 0   ? 'bg-slate-100 text-slate-500 ring-slate-200' :
              totalWeight > 100   ? 'bg-rose-50 text-rose-700 ring-rose-200' :
                                    'bg-amber-50 text-amber-800 ring-amber-200')}>
              Total weight: {fmtNum(totalWeight)}%
            </div>
          }
        />

        {/* All metrics in one grid, two per row: payout KPIs first, then monitor KPIs with deduction bands. */}
        {payoutKpis.length === 0 && monitorKpis.length === 0 && otherDeductions.length === 0 ? (
          <div className="text-sm text-slate-500 italic">No KPIs on this plan.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {payoutKpis.map((k) => {
              const slab = slabFor(k.kpi_uid);
              return (
                <div key={k.kpi_uid} className="min-w-0 border border-slate-200 rounded-lg p-4 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate">{k.kpi_name}</div>
                      <div className="text-xs text-slate-500 font-mono truncate">
                        {k.kpi_code}{k.kpi_category ? ` · ${k.kpi_category}` : ''} · {directionLabel(k.direction).toLowerCase()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="badge badge-primary text-[11px]">Weight {fmtNum(k.weight)}%</span>
                      <span className="badge badge-neutral text-[11px]">Target {fmtNum(k.target_value)}{k.unit === 'percentage' ? '%' : ''}</span>
                      {slab?.role_name && <span className="badge badge-neutral text-[11px]">Role: {slab.role_name}</span>}
                    </div>
                  </div>
                  <AchievementLadder tiers={slab?.tiers ?? []} currency={plan.currency_code} />
                </div>
              );
            })}
            {monitorKpis.map((k) => (
              <DeductionKpiCard
                key={k.kpi_uid}
                title={k.kpi_name}
                code={k.kpi_code}
                subtitle={directionLabel(k.direction).toLowerCase()}
                target={<>Target {fmtNum(k.target_value)}{k.unit === 'percentage' ? '%' : ''}</>}
                bands={dedsFor(k.kpi_uid)}
              />
            ))}
            {/* Bands attached to KPIs that are not monitor KPIs (edge case) */}
            {otherDeductions.length > 0 && (
              <DeductionKpiCard title="Other deduction bands" subtitle="not tied to a monitor KPI" bands={otherDeductions} />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
