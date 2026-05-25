'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, FileText, Calendar, Users, Target, Search, Sparkles, MapPin,
  LayoutGrid, Rows3, Copy, Archive, Trash2,
} from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { Badge, PillTabs } from '@/components/ui/Pill';
import PageHero from '@/components/layout/PageHero';

interface Plan {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'expired' | 'archived';
  plan_type: string;
  effective_from: string;
  effective_to: string;
  base_payout: number;
  currency?: string;
  kpi_count: number;
  territory_count: number;
  roles: { id: string; name: string }[];
}

const STATUS_TONE: Record<Plan['status'], 'success' | 'neutral' | 'warning' | 'danger'> = {
  active: 'success', draft: 'neutral', expired: 'warning', archived: 'danger',
};

type ViewMode = 'grid' | 'table';

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | Plan['status']>('all');
  const [view, setView] = useState<ViewMode>('table');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = () => {
    setLoading(true);
    api.get<unknown, Plan[]>('/plans')
      .then(setPlans)
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Persist view preference
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('plans-view') : null;
    if (saved === 'grid' || saved === 'table') setView(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('plans-view', view);
  }, [view]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: plans.length, active: 0, draft: 0, expired: 0, archived: 0 };
    for (const p of plans) c[p.status]++;
    return c;
  }, [plans]);

  const visible = useMemo(() => plans.filter((p) => {
    if (filter !== 'all' && p.status !== filter) return false;
    if (!search) return true;
    return p.name.toLowerCase().includes(search.toLowerCase());
  }), [plans, search, filter]);

  // Reset selection when filter/search changes
  useEffect(() => { setSelected(new Set()); }, [filter, search]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((p) => p.id)));
  };

  const bulkArchive = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Archive ${selected.size} plan${selected.size > 1 ? 's' : ''}?`)) return;
    let ok = 0, fail = 0;
    for (const id of Array.from(selected)) {
      try { await api.put(`/plans/${id}`, { status: 'archived' }); ok++; }
      catch { fail++; }
    }
    toast.success(`${ok} archived${fail ? `, ${fail} failed` : ''}`);
    setSelected(new Set());
    load();
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHero
        eyebrow="Setup"
        title="Plans"
        subtitle="Design once, run monthly, refine as policy evolves."
        actions={
          <Link href="/plans/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New plan
          </Link>
        }
      />

      {/* Filter row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PillTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all',      label: 'All',      count: counts.all },
            { value: 'active',   label: 'Active',   count: counts.active },
            { value: 'draft',    label: 'Drafts',   count: counts.draft },
            { value: 'expired',  label: 'Expired',  count: counts.expired },
            { value: 'archived', label: 'Archived', count: counts.archived },
          ]}
        />
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plans…"
              className="input pl-9 w-56"
            />
          </div>
          {/* View toggle */}
          <div className="inline-flex rounded-md border bg-background p-0.5">
            <button
              onClick={() => setView('table')}
              className={cn(
                'inline-flex items-center justify-center h-7 w-7 rounded transition-colors',
                view === 'table' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              title="Table view"
            >
              <Rows3 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView('grid')}
              className={cn(
                'inline-flex items-center justify-center h-7 w-7 rounded transition-colors',
                view === 'grid' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              title="Grid view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="card flex items-center justify-between px-4 py-2.5 animate-fade-in">
          <span className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium tabular-nums">{selected.size}</span> selected
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set())} className="btn-ghost btn-sm">Clear</button>
            <button onClick={bulkArchive} className="btn-outline btn-sm">
              <Archive className="h-3.5 w-3.5" /> Archive
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        view === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-md" />)}
          </div>
        )
      ) : visible.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={search ? 'No plans match' : 'No plans yet'}
          description={search ? 'Try a different search term.' : 'Start by creating your first commission plan.'}
          action={!search && <Link href="/plans/new" className="btn-primary"><Plus className="w-4 h-4" /> Create your first plan</Link>}
        />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((p) => <PlanCard key={p.id} plan={p} selected={selected.has(p.id)} onToggle={() => toggle(p.id)} />)}
        </div>
      ) : (
        <PlanTable
          plans={visible}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          allSelected={selected.size === visible.length && visible.length > 0}
        />
      )}
    </div>
  );
}

function PlanCard({ plan, selected, onToggle }: { plan: Plan; selected: boolean; onToggle: () => void }) {
  return (
    <div className={cn(
      'card p-5 group relative overflow-hidden transition-shadow hover:shadow-md',
      selected && 'ring-2 ring-primary/40'
    )}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-3 right-3 rounded border-input"
        title="Select plan"
      />
      <Link href={`/plans/${plan.id}`} className="block">
        <header className="flex items-start justify-between mb-3 pr-7">
          <div className="h-10 w-10 rounded-md bg-primary/10 dark:bg-primary/20 flex items-center justify-center text-primary border border-primary/20">
            <FileText className="h-5 w-5" />
          </div>
          <Badge tone={STATUS_TONE[plan.status]}>{plan.status}</Badge>
        </header>

        <h3 className="font-semibold text-foreground text-base leading-tight">{plan.name}</h3>
        <div className="mt-0.5 text-xs text-muted-foreground capitalize">{plan.plan_type} plan</div>

        {plan.description && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{plan.description}</p>
        )}

        <dl className="mt-4 space-y-1.5 text-xs">
          <Row icon={Calendar} label="Effective">
            {formatDate(plan.effective_from)} → {formatDate(plan.effective_to)}
          </Row>
          <Row icon={Target} label="KPIs">{plan.kpi_count}</Row>
          <Row icon={MapPin} label="Territories">{plan.territory_count}</Row>
          <Row icon={Users}  label="Base payout"><span className="font-semibold tabular-nums">{formatCurrency(plan.base_payout, plan.currency)}</span></Row>
        </dl>

        {plan.roles?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1">
            {plan.roles.slice(0, 4).map((r) => (
              <span key={r.id} className="badge badge-soft">{r.name}</span>
            ))}
            {plan.roles.length > 4 && (
              <span className="badge badge-soft">+{plan.roles.length - 4} more</span>
            )}
          </div>
        )}
      </Link>
    </div>
  );
}

function PlanTable({ plans, selected, onToggle, onToggleAll, allSelected }: {
  plans: Plan[]; selected: Set<string>;
  onToggle: (id: string) => void; onToggleAll: () => void; allSelected: boolean;
}) {
  return (
    <section className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground bg-muted/40 border-b">
          <tr>
            <th className="pl-4 pr-2 py-3 w-8">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} className="rounded border-input" />
            </th>
            <th className="text-left px-2 py-3 font-semibold">Plan</th>
            <th className="text-left px-2 py-3 font-semibold">Status</th>
            <th className="text-left px-2 py-3 font-semibold">Type</th>
            <th className="text-left px-2 py-3 font-semibold">Effective</th>
            <th className="text-right px-2 py-3 font-semibold">KPIs</th>
            <th className="text-right px-2 py-3 font-semibold">Territories</th>
            <th className="text-right pl-2 pr-4 py-3 font-semibold">Base payout</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.id} className={cn(
              'border-t hover:bg-accent transition-colors',
              selected.has(p.id) && 'bg-primary/5'
            )}>
              <td className="pl-4 pr-2 py-3">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => onToggle(p.id)} className="rounded border-input" />
              </td>
              <td className="px-2 py-3">
                <Link href={`/plans/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                {p.description && <div className="text-xs text-muted-foreground line-clamp-1">{p.description}</div>}
              </td>
              <td className="px-2 py-3"><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></td>
              <td className="px-2 py-3 capitalize text-muted-foreground">{p.plan_type}</td>
              <td className="px-2 py-3 font-mono text-xs text-muted-foreground tabular-nums">{formatDate(p.effective_from)} → {formatDate(p.effective_to)}</td>
              <td className="px-2 py-3 text-right tabular-nums">{p.kpi_count}</td>
              <td className="px-2 py-3 text-right tabular-nums">{p.territory_count}</td>
              <td className="pl-2 pr-4 py-3 text-right font-semibold tabular-nums">{formatCurrency(p.base_payout, p.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Row({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" /> {label}
      </span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}
