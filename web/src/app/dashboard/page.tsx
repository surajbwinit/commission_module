'use client';
import React, { useEffect, useState, useMemo } from 'react';
import {
  Trophy, Crown, Medal, Wallet, DollarSign, Users, Target, TrendingUp, TrendingDown,
  Award, Flame, Shield, Sparkles, ChevronRight, ChevronDown, ArrowUpRight,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import api from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { formatCurrency, formatPercent, cn } from '@/lib/utils';
import StatCard from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Pill';
import { useTheme } from '@/components/theme/ThemeProvider';
import PageHero from '@/components/layout/PageHero';

interface PayoutRow {
  uid: string;
  emp_uid: string;
  employee_name: string;
  role_name: string;
  plan_name: string;                 // comma-joined when employee is on multiple plans
  plan_count?: number;
  net_payout: number;
  gross_payout?: number;
  achievement_percent?: number;
  territory_name?: string;
}

interface DashboardData {
  plan_count: number;
  employee_count: number;
  kpi_count: number;
  total_payout: number;
  run_count: number;
  earners_count: number;
  payout_population: number;
  avg_payout: number;
  median_payout: number;
  currency_code: string | null;
  currency_symbol: string | null;
}

// ─── Tier classification ────────────────────────────────────────
function tierOf(achievement: number) {
  if (achievement >= 110) return 'champion';
  if (achievement >= 100) return 'high_performer';
  if (achievement >=  85) return 'on_track';
  if (achievement >=  70) return 'developing';
  return 'below_target';
}
const TIER = {
  champion: {
    label: 'Champions',
    text: 'text-amber-700 dark:text-amber-300',
    bg:   'bg-amber-50 dark:bg-amber-500/10',
    ring: 'ring-amber-200 dark:ring-amber-500/30',
    bar:  'bg-amber-400',
    icon: Crown,
    glow: 'from-amber-300/40',
  },
  high_performer: {
    label: 'High Performers',
    text: 'text-emerald-700 dark:text-emerald-300',
    bg:   'bg-emerald-50 dark:bg-emerald-500/10',
    ring: 'ring-emerald-200 dark:ring-emerald-500/30',
    bar:  'bg-emerald-400',
    icon: Flame,
    glow: 'from-emerald-300/40',
  },
  on_track: {
    label: 'On Track',
    text: 'text-sky-700 dark:text-sky-300',
    bg:   'bg-sky-50 dark:bg-sky-500/10',
    ring: 'ring-sky-200 dark:ring-sky-500/30',
    bar:  'bg-sky-400',
    icon: Target,
    glow: 'from-sky-300/40',
  },
  developing: {
    label: 'Developing',
    text: 'text-slate-700 dark:text-slate-300',
    bg:   'bg-slate-50 dark:bg-slate-500/10',
    ring: 'ring-slate-200 dark:ring-slate-500/30',
    bar:  'bg-slate-300 dark:bg-slate-500',
    icon: Shield,
    glow: 'from-slate-300/40',
  },
  below_target: {
    label: 'Below Target',
    text: 'text-rose-700 dark:text-rose-300',
    bg:   'bg-rose-50 dark:bg-rose-500/10',
    ring: 'ring-rose-200 dark:ring-rose-500/30',
    bar:  'bg-rose-300 dark:bg-rose-400',
    icon: Target,
    glow: 'from-rose-300/40',
  },
} as const;
type TierKey = keyof typeof TIER;

const TIER_ORDER: TierKey[] = ['champion', 'high_performer', 'on_track', 'developing', 'below_target'];
const TIER_RANGE: Record<TierKey, string> = {
  champion:       '≥ 110%',
  high_performer: '100–110%',
  on_track:       '85–100%',
  developing:     '70–85%',
  below_target:   '< 70%',
};

// ─── Page ───────────────────────────────────────────────────────
// Salesperson-style dashboards are shown to individual contributors (their own
// payout breakdown). Everyone else (managers, admins) sees the executive view.
// Source role codes follow the Winit `roles.code` convention (e.g. 'SALESMAN', 'SR').
const IC_ROLE_CODES = new Set(['SALESMAN', 'SR']);

export default function DashboardPage() {
  const { selectedPeriod, currentPersona } = useAppStore();
  const isSalesperson = !!currentPersona && IC_ROLE_CODES.has(currentPersona.role_code);
  return isSalesperson && currentPersona
    ? <SalespersonDashboard period={selectedPeriod} empUid={currentPersona.uid} name={currentPersona.name} />
    : <ExecutiveDashboard period={selectedPeriod} />;
}

// ═══════════════════════════════════════════════════════════════
// Executive Dashboard
// ═══════════════════════════════════════════════════════════════
function ExecutiveDashboard({ period }: { period: string }) {
  const [summary, setSummary] = useState<DashboardData | null>(null);
  const [leaderboard, setLeaderboard] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<unknown, DashboardData>(`/dashboard/summary?period=${period}`),
      api.get<unknown, PayoutRow[]>(`/dashboard/top-performers?period=${period}&limit=50`),
    ])
      .then(([s, top]) => { setSummary(s); setLeaderboard(top); })
      .catch(() => { setSummary(null); setLeaderboard([]); })
      .finally(() => setLoading(false));
  }, [period]);

  const byTier = useMemo(() => {
    const buckets: Record<TierKey, PayoutRow[]> = {
      champion: [], high_performer: [], on_track: [], developing: [], below_target: [],
    };
    for (const row of leaderboard) {
      const a = row.achievement_percent ?? (row.net_payout > 0 ? 100 : 0);
      buckets[tierOf(a)].push(row);
    }
    return buckets;
  }, [leaderboard]);

  const distribution = useMemo(() => {
    // Single-hue scale — sober FMCG palette using primary (violet) at varying lightness
    const buckets = [
      { name: '< 70%',    range: [0, 70],     count: 0, color: 'hsl(var(--primary) / 0.25)' },
      { name: '70-85%',   range: [70, 85],    count: 0, color: 'hsl(var(--primary) / 0.40)' },
      { name: '85-100%',  range: [85, 100],   count: 0, color: 'hsl(var(--primary) / 0.60)' },
      { name: '100-110%', range: [100, 110],  count: 0, color: 'hsl(var(--primary) / 0.80)' },
      { name: '≥ 110%',   range: [110, 999],  count: 0, color: 'hsl(var(--primary) / 1.0)'  },
    ];
    for (const row of leaderboard) {
      const a = row.achievement_percent ?? (row.net_payout > 0 ? 100 : 0);
      const b = buckets.find((bk) => a >= bk.range[0] && a < bk.range[1]);
      if (b) b.count++;
    }
    return buckets;
  }, [leaderboard]);

  const top3 = leaderboard.slice(0, 3);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHero
        title="Dashboard"
        subtitle={formatPeriodLabel(period)}
      />

      {/* Payout headline — three primary tiles with stronger visual treatment */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <PayoutTile
          icon={Wallet}
          tone="violet"
          label="Total payout"
          loading={!summary}
          value={summary ? (
            <span title={summary.currency_code ? `${summary.currency_code} ${summary.total_payout.toLocaleString()}` : undefined}>
              {formatCurrency(summary.total_payout, summary.currency_code)}
            </span>
          ) : null}
          hint={summary ? `${summary.run_count} calc run${summary.run_count === 1 ? '' : 's'} this period` : null}
        />
        <PayoutTile
          icon={Users}
          tone="emerald"
          label="Earning commission"
          loading={!summary}
          value={summary ? (
            <span className="tabular-nums">
              {summary.earners_count}
              <span className="text-muted-foreground/70 font-normal text-xl"> / {summary.payout_population}</span>
            </span>
          ) : null}
          hint={summary && summary.payout_population > 0 ? (
            <EarnersBar earners={summary.earners_count} total={summary.payout_population} />
          ) : 'No payouts yet'}
        />
        <PayoutTile
          icon={TrendingUp}
          tone="amber"
          label="Avg payout"
          loading={!summary}
          value={summary ? formatCurrency(summary.avg_payout, summary.currency_code) : null}
          hint={summary ? `Across ${summary.payout_population} payouts this period` : null}
        />
      </div>

      {/* Secondary counts — supporting tiles */}
      <div className="grid grid-cols-3 rounded-xl border bg-card shadow-sm divide-x overflow-hidden">
        <KpiTile
          label="Active employees"
          value={summary?.employee_count ?? <Skeleton className="h-7 w-16" />}
          hint="across all plans"
        />
        <KpiTile
          label="Active plans"
          value={summary?.plan_count ?? <Skeleton className="h-7 w-16" />}
          hint="running this period"
        />
        <KpiTile
          label="KPIs in library"
          value={summary?.kpi_count ?? <Skeleton className="h-7 w-16" />}
          hint="reusable metrics"
        />
      </div>

      {loading ? (
        <PodiumSkeleton />
      ) : top3.length > 0 ? (
        <Podium rows={top3} />
      ) : (
        <EmptyState
          icon={Trophy}
          title="No commission data for this period"
          description="Run a calculation for this period to populate the leaderboard."
        />
      )}

      {/* Performance tiers — 5 separate cards, one per tier */}
      {leaderboard.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Performance tiers</h2>
            <span className="text-xs text-slate-500">
              {leaderboard.length} employee{leaderboard.length === 1 ? '' : 's'} this period
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {TIER_ORDER.map((key) => (
              <TierCard
                key={key}
                tierKey={key}
                employees={byTier[key]}
                totalEmployees={leaderboard.length}
              />
            ))}
          </div>
        </section>
      )}

      {/* Achievement spread — full width section */}
      <section className="card p-6">
        <div className="section-head">
          <div>
            <h2>Achievement spread</h2>
            <p>How many employees land in each performance band this period.</p>
          </div>
          <Badge tone="soft">{leaderboard.length} employees</Badge>
        </div>
        <DistributionChart data={distribution} />
      </section>

      <Leaderboard rows={leaderboard} loading={loading} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Salesperson Dashboard
// ═══════════════════════════════════════════════════════════════
function SalespersonDashboard({ period, empUid, name }: { period: string; empUid: string; name: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<unknown, any>(`/dashboard/salesperson/${empUid}?period=${period}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [empUid, period]);

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHero
        title={`${name.split(' ')[0]}'s Commission`}
        subtitle={formatPeriodLabel(period)}
      />
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : !data?.payout ? (
        <EmptyState
          icon={Trophy}
          title="No commission yet for this period"
          description="Your payout will appear here once a calculation runs for your plan."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={Wallet}     tone="violet"  label="Your payout" value={formatCurrency(data.payout.net_payout)} />
            <StatCard icon={DollarSign} tone="emerald" label="Your sales"  value={formatCurrency(data.total_sales)} />
            <StatCard icon={Award}      tone="amber"   label="Rank"        value={`#${data.rank ?? '—'} of ${data.total_peers ?? '—'}`} />
            <StatCard icon={Target}     tone="sky"     label="Plan"        value={data.payout.plan_name} />
          </div>

          <section className="card overflow-hidden">
            <div className="section-head px-5 pt-5">
              <div><h2>Your KPIs this month</h2><p>Per-KPI achievement and what each contributed to your payout.</p></div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wider text-fg-subtle bg-sunken/40">
                <tr>
                  <th className="text-left pl-5 px-2 py-2.5">KPI</th>
                  <th className="text-right px-2 py-2.5">Target</th>
                  <th className="text-right px-2 py-2.5">Actual</th>
                  <th className="text-left px-2 py-2.5 w-[35%]">% of target</th>
                  <th className="text-right pl-2 pr-5 py-2.5">Payout</th>
                </tr>
              </thead>
              <tbody>
                {(data.kpi_results ?? []).map((k: any) => {
                  const pct = Number(k.achievement_percent ?? 0);
                  const bar = pct >= 100 ? 'bg-emerald-400' : pct >= 85 ? 'bg-sky-400' : pct >= 70 ? 'bg-amber-400' : 'bg-rose-400';
                  return (
                    <tr key={k.uid} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="pl-5 px-2 py-3">
                        <div className="font-medium text-fg">{k.kpi_name}</div>
                        <div className="text-2xs font-mono text-fg-subtle">{k.kpi_code}</div>
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums text-fg-muted">{k.target_value}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-fg">{k.actual_value}</td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-sunken rounded-full overflow-hidden">
                            <div className={cn('h-full transition-all duration-500', bar)} style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                          <span className="tabular-nums font-medium text-sm w-14 text-right text-fg">{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="pl-2 pr-5 py-3 text-right font-semibold tabular-nums text-fg">{formatCurrency(k.weighted_payout)}</td>
                    </tr>
                  );
                })}
                {(!data.kpi_results || data.kpi_results.length === 0) && (
                  <tr><td colSpan={5} className="px-5 py-4 text-center text-sm text-fg-muted">No KPI breakdown available.</td></tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function PageHeader({ title, subtitle, accessory }: { title: string; subtitle?: string; accessory?: React.ReactNode }) {
  return <PageHero title={title} subtitle={subtitle} accessory={accessory} />;
}

function TierCard({
  tierKey, employees, totalEmployees,
}: {
  tierKey: TierKey;
  employees: PayoutRow[];
  totalEmployees: number;
}) {
  const meta = TIER[tierKey];
  const Icon = meta.icon;
  const count = employees.length;
  const totalPayout = employees.reduce((s, e) => s + (e.net_payout || 0), 0);
  const pct = totalEmployees > 0 ? Math.round((count / totalEmployees) * 100) : 0;

  return (
    <article className="card p-4 relative overflow-hidden group transition-shadow hover:shadow-md">
      {/* Coloured accent bar on the left edge */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-1', meta.bar)} />

      <div className="flex items-start justify-between mb-3">
        <div className={cn('h-8 w-8 rounded-md ring-1 flex items-center justify-center', meta.bg, meta.ring, meta.text)}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">{TIER_RANGE[tierKey]}</span>
      </div>

      <div className={cn('text-xs font-medium', meta.text)}>{meta.label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-800 dark:text-slate-100 leading-none">
        {count}
        <span className="ml-1.5 text-xs font-normal text-slate-500">
          {count === 1 ? 'employee' : 'employees'}
        </span>
      </div>

      <div className="mt-3 text-xs text-slate-500">
        <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">
          {formatCurrency(totalPayout)}
        </span>
        {' '}total payout
      </div>

      {/* Share-of-team progress bar */}
      <div className="mt-3 h-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
        <div className={cn('h-full transition-all', meta.bar)} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[10px] text-slate-400 tabular-nums">{pct}% of team</div>
    </article>
  );
}

function KpiTile({
  label, value, hint, featured = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <div className={cn(
      'relative min-w-0 px-6 py-5 transition-colors',
      featured ? 'bg-muted/40' : 'bg-card hover:bg-muted/20'
    )}>
      {featured && <div className="absolute inset-x-0 top-0 h-px bg-primary" />}
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground truncate">{label}</div>
      <div className={cn(
        'mt-2 tabular-nums tracking-tight text-foreground leading-none truncate',
        featured ? 'text-2xl md:text-3xl font-semibold' : 'text-xl md:text-2xl font-semibold'
      )}>
        {value}
      </div>
      {hint && <div className="mt-1.5 text-xs text-muted-foreground truncate">{hint}</div>}
    </div>
  );
}

const PAYOUT_TONES = {
  violet:  { chip: 'bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/20', bar: 'bg-violet-500' },
  emerald: { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20', bar: 'bg-emerald-500' },
  amber:   { chip: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20', bar: 'bg-amber-500' },
} as const;
type PayoutTone = keyof typeof PAYOUT_TONES;

function PayoutTile({
  icon: Icon, tone, label, value, hint, loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: PayoutTone;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  loading?: boolean;
}) {
  const t = PAYOUT_TONES[tone];
  return (
    <article className="relative overflow-hidden rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow p-5">
      <div className={cn('absolute left-0 top-0 bottom-0 w-1', t.bar)} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl md:text-3xl font-semibold tabular-nums tracking-tight text-foreground leading-none">
            {loading ? <Skeleton className="h-8 w-32" /> : value}
          </div>
        </div>
        <div className={cn('shrink-0 h-9 w-9 rounded-md ring-1 flex items-center justify-center', t.chip)}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
      <div className="mt-3 text-xs text-muted-foreground min-h-[1rem]">{loading ? <Skeleton className="h-3 w-24" /> : hint}</div>
    </article>
  );
}

function EarnersBar({ earners, total }: { earners: number; total: number }) {
  const pct = total > 0 ? Math.round((earners / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-[11px] font-medium text-muted-foreground">{pct}%</span>
    </div>
  );
}

function DistributionChart({ data }: { data: { name: string; count: number; color: string }[] }) {
  const { resolved } = useTheme();
  const gridStroke   = resolved === 'dark' ? '#26293305' : '#e2e8f0';
  const axisFill     = resolved === 'dark' ? '#6e7480'   : '#94a3b8';
  const cursorFill   = resolved === 'dark' ? 'rgb(129 140 248 / 0.10)' : 'rgb(99 102 241 / 0.06)';
  const tooltipBg    = resolved === 'dark' ? 'rgb(17 19 25 / 0.95)'    : 'rgb(15 23 42 / 0.92)';
  const tooltipFg    = resolved === 'dark' ? '#f5f7fa' : '#ffffff';
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: axisFill }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: axisFill }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: tooltipBg, border: 'none', borderRadius: '8px', color: tooltipFg, fontSize: '12px', boxShadow: '0 8px 24px rgb(0 0 0 / 0.25)' }}
          cursor={{ fill: cursorFill }}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Podium({ rows }: { rows: PayoutRow[] }) {
  const top3 = rows.slice(0, 3);
  return (
    <section className="relative overflow-hidden rounded-xl border bg-card p-6 shadow-sm">
      <div className="pointer-events-none absolute inset-0 bg-dots bg-dots-fade opacity-50" />
      <div className="relative">
        <div className="section-head mb-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Top performers</h2>
            <p>Ranked by net payout this period.</p>
          </div>
          <Badge tone="warning"><Trophy className="w-3 h-3" /> Top 3</Badge>
        </div>
        <ol className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {top3.map((row, idx) => {
            const rank = idx + 1;
            const isFirst = rank === 1;
            return (
              <li key={row.uid} className={cn(
                'group relative overflow-hidden rounded-xl border bg-background p-5 transition-all',
                'hover:shadow-md',
                isFirst && 'border-foreground/30'
              )}>
                {isFirst && <div className="absolute inset-x-0 top-0 h-0.5 bg-foreground" />}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className={cn(
                      'inline-flex items-center justify-center h-7 w-7 rounded-full border text-xs font-semibold',
                      isFirst ? 'border-foreground bg-foreground text-background' : 'border-border bg-muted text-foreground'
                    )}>{rank}</span>
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'} place
                    </span>
                  </div>
                </div>
                <div className="font-semibold text-foreground truncate">{row.employee_name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{row.role_name}</div>
                <div className="mt-4 pt-3 border-t">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1">Net payout</div>
                  <div className="text-2xl font-semibold tabular-nums text-foreground tracking-tight">
                    {formatCurrency(row.net_payout)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function PodiumSkeleton() {
  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm">
      <Skeleton className="h-4 w-32 mb-2" />
      <Skeleton className="h-3 w-48 mb-6" />
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border p-5 space-y-3">
            <Skeleton className="h-10 w-12" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-28 mt-4" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Leaderboard({ rows, loading }: { rows: PayoutRow[]; loading: boolean }) {
  const maxPayout = Math.max(...rows.map((r) => r.net_payout), 1);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  return (
    <section className="card overflow-hidden">
      <div className="section-head px-5 pt-5 mb-3">
        <div><h2>Full leaderboard</h2><p>All employees ranked by net payout. Click a row to see their KPI breakdown.</p></div>
        <Badge tone="soft">{rows.length} rows</Badge>
      </div>
      {loading ? (
        <div className="px-5 pb-5 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 pb-8 text-center text-sm text-fg-muted">No payouts to show.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-2xs uppercase tracking-wider text-fg-subtle bg-sunken/40 sticky top-0 backdrop-blur z-10">
            <tr>
              <th className="text-left pl-5 pr-2 py-2.5 w-10">#</th>
              <th className="text-left px-2 py-2.5">Employee</th>
              <th className="text-left px-2 py-2.5">Role</th>
              <th className="text-left px-2 py-2.5">Plan</th>
              <th className="text-left px-2 py-2.5 w-[28%]">Performance</th>
              <th className="text-right pl-2 pr-5 py-2.5">Payout</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const a = row.achievement_percent ?? (row.net_payout > 0 ? 100 : 0);
              const t = TIER[tierOf(a)];
              const TierIcon = t.icon;
              const isTop3 = idx < 3;
              const medals = ['🥇', '🥈', '🥉'];
              const isMulti = (row.plan_count ?? 1) > 1;
              const isOpen  = expandedRow === row.uid;
              const planList = row.plan_name?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
              return (
                <React.Fragment key={row.uid}>
                <tr className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40 transition-colors group">
                  <td className="pl-5 pr-2 py-3 font-mono text-xs text-fg-muted tabular-nums">
                    {isTop3 ? <span className="text-base">{medals[idx]}</span> : (idx + 1).toString().padStart(2, '0')}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-300 via-primary-500 to-violet-600 text-white text-xs font-semibold flex items-center justify-center ring-2 ring-surface shadow-sm">
                        {row.employee_name.charAt(0)}
                      </div>
                      <span className="font-medium text-fg">{row.employee_name}</span>
                    </div>
                  </td>
                  <td className="px-2 py-3 text-fg-muted">{row.role_name}</td>
                  <td className="px-2 py-3">
                    {isMulti ? (
                      <button
                        type="button"
                        onClick={() => setExpandedRow(isOpen ? null : row.uid)}
                        className={cn(
                          'badge badge-soft inline-flex items-center gap-1 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700',
                          isOpen && 'bg-primary/15 text-primary'
                        )}
                      >
                        {row.plan_count} plans
                        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                      </button>
                    ) : (
                      <span className="badge badge-soft" title={row.plan_name}>{row.plan_name}</span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-2">
                      <div className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-2xs font-semibold ring-1 ring-inset', t.bg, t.text, t.ring)}>
                        <TierIcon className="w-3 h-3" />
                        {t.label}
                      </div>
                      <div className="flex-1 max-w-[140px] h-1.5 bg-sunken rounded-full overflow-hidden">
                        <div className={cn('h-full transition-all duration-500', t.bar)} style={{ width: `${Math.min(100, (row.net_payout / maxPayout) * 100)}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="pl-2 pr-5 py-3 text-right font-semibold text-fg tabular-nums">
                    {formatCurrency(row.net_payout)}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-slate-50/60 dark:bg-slate-800/40">
                    <td colSpan={6} className="pl-5 pr-5 py-3">
                      <div className="text-2xs uppercase tracking-wider text-fg-subtle mb-2">
                        Plans contributing to {row.employee_name}'s payout
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {planList.map((name) => (
                          <span key={name} className="badge badge-info text-xs">{name}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function formatPeriodLabel(p: string) {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}
