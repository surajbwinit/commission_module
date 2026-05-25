'use client';
import { useEffect, useState, useMemo } from 'react';
import {
  Trophy, Crown, Medal, Wallet, DollarSign, Users, Target, TrendingUp, TrendingDown,
  Award, Flame, Shield, Sparkles, ChevronRight, ArrowUpRight,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import api from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { formatCurrency, formatCurrencyCompact, formatPercent, cn } from '@/lib/utils';
import StatCard from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Pill';
import { useTheme } from '@/components/theme/ThemeProvider';
import PageHero from '@/components/layout/PageHero';

interface PayoutRow {
  id: string;
  employee_id: string;
  employee_name: string;
  role_name: string;
  plan_name: string;
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

// ─── Page ───────────────────────────────────────────────────────
export default function DashboardPage() {
  const { selectedPeriod, currentPersona } = useAppStore();
  const isSalesperson = currentPersona.roleId === 'role-salesman' || currentPersona.roleId === 'role-sr';
  return isSalesperson
    ? <SalespersonDashboard period={selectedPeriod} employeeId={currentPersona.id} name={currentPersona.name} />
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
        eyebrow="Home"
        title={`Commission · ${formatPeriodLabel(period)}`}
      />

      {/* KPI strip — 4 equal cards, with the total payout deliberately accented */}
      <div className="grid grid-cols-2 lg:grid-cols-4 rounded-xl border bg-card shadow-sm divide-x divide-y lg:divide-y-0 overflow-hidden">
        <KpiTile
          label="Total payout"
          value={summary
            ? <span title={formatCurrency(summary.total_payout)}>{formatCurrencyCompact(summary.total_payout)}</span>
            : <Skeleton className="h-7 w-32" />}
          hint={summary ? `${summary.run_count} calc run${summary.run_count === 1 ? '' : 's'}` : null}
          featured
        />
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
function SalespersonDashboard({ period, employeeId, name }: { period: string; employeeId: string; name: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<unknown, any>(`/dashboard/salesperson/${employeeId}?period=${period}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [employeeId, period]);

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHero
        eyebrow={`Period · ${formatPeriodLabel(period)}`}
        title={`Hi, ${name.split(' ')[0]}`}
        subtitle="Here's how your commission is shaping up this period."
        accessory={<Badge tone="purple"><Sparkles className="w-3 h-3" /> Salesperson view</Badge>}
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
                    <tr key={k.id} className="border-t border-line/60 hover:bg-sunken/40 transition-colors">
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
              <li key={row.id} className={cn(
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
              return (
                <tr key={row.id} className="border-t border-line/60 hover:bg-sunken/40 transition-colors group">
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
                    <span className="badge badge-soft">{row.plan_name}</span>
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
