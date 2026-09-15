'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, FileText, Calendar, Target, Search,
  LayoutGrid, Rows3, Archive, Eye, Pencil,
} from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { Badge, PillTabs } from '@/components/ui/Pill';
import PageHero from '@/components/layout/PageHero';

interface Plan {
  uid: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'expired' | 'archived';
  plan_type: string;
  effective_from: string;
  effective_to: string;
  base_payout: number;
  currency_uid?: string;
  currency_code?: string;
  currency_symbol?: string;
  kpi_count: number;
  sales_office_count: number;
  roles: { uid: string; name: string }[];
}

// Visually punchy status pill — colored dot + tinted bg + bold text so the
// status is readable at a glance. Each of the 4 statuses has its own colour.
const STATUS_STYLES: Record<Plan['status'], { pill: string; dot: string; label: string }> = {
  active:   { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
              dot:  'bg-emerald-500', label: 'Active' },
  draft:    { pill: 'bg-amber-50   text-amber-800  ring-amber-200  dark:bg-amber-500/15  dark:text-amber-300  dark:ring-amber-500/30',
              dot:  'bg-amber-500',  label: 'Draft' },
  expired:  { pill: 'bg-slate-100  text-slate-700  ring-slate-200  dark:bg-slate-700/40  dark:text-slate-300  dark:ring-slate-600',
              dot:  'bg-slate-400',  label: 'Expired' },
  archived: { pill: 'bg-rose-50    text-rose-700   ring-rose-200   dark:bg-rose-500/15   dark:text-rose-300   dark:ring-rose-500/30',
              dot:  'bg-rose-500',   label: 'Archived' },
};

function StatusPill({ status }: { status: Plan['status'] }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset',
      s.pill,
    )}>
      <span className={cn('inline-block w-1.5 h-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}


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

  const toggle = (uid: string) => {
    const next = new Set(selected);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((p) => p.uid)));
  };

  const bulkArchive = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Archive ${selected.size} plan${selected.size > 1 ? 's' : ''}?`)) return;
    let ok = 0, fail = 0;
    for (const uid of Array.from(selected)) {
      try { await api.put(`/plans/${uid}`, { status: 'archived' }); ok++; }
      catch { fail++; }
    }
    toast.success(`${ok} archived${fail ? `, ${fail} failed` : ''}`);
    setSelected(new Set());
    load();
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHero
        title="Commission Plans"
        actions={
          <Link href="/plans/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Plan
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
          {visible.map((p) => <PlanCard key={p.uid} plan={p} selected={selected.has(p.uid)} onToggle={() => toggle(p.uid)} />)}
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
      'card p-6 relative cursor-pointer transition-shadow hover:shadow-md',
      selected && 'ring-2 ring-primary/40'
    )}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-3 right-3 rounded border-input z-10"
        title="Select plan"
      />
      <Link href={`/plans/${plan.uid}`} className="block">
        {/* Header row: icon chip + name/type on the left, status badge on the right */}
        <div className="flex items-start justify-between mb-4 pr-7">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground leading-tight truncate">{plan.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5 capitalize">{plan.plan_type}</p>
            </div>
          </div>
          <StatusPill status={plan.status} />
        </div>

        {plan.description && (
          <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{plan.description}</p>
        )}

        {/* Two-column meta row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="w-4 h-4 shrink-0" />
            <span className="truncate">{formatDate(plan.effective_from)} → {formatDate(plan.effective_to)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 shrink-0" />
            <span>{plan.kpi_count} KPIs</span>
          </div>
        </div>

        {/* Base payout */}
        <div className="flex items-center gap-2 mb-3 text-sm">
          <span className="text-xs text-muted-foreground">Base payout</span>
          <span className="font-semibold tabular-nums text-foreground">
            {formatCurrency(plan.base_payout, plan.currency_code)}
          </span>
        </div>

        {/* Role badges */}
        {plan.roles?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {plan.roles.slice(0, 4).map((r) => (
              <span key={r.uid} className="badge badge-info text-xs">{r.name}</span>
            ))}
            {plan.roles.length > 4 && (
              <span className="badge badge-soft text-xs">+{plan.roles.length - 4}</span>
            )}
          </div>
        )}
      </Link>
    </div>
  );
}

/**
 * Row-level actions: a blue eye button that opens a small menu with
 * "View" (read-only page) and "Edit" (plan builder).
 */
function ActionsMenu({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Actions"
        aria-label={`Actions for ${plan.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center justify-center h-7 w-7 rounded-md text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors dark:text-blue-400 dark:hover:bg-blue-500/10',
          open && 'bg-blue-50 dark:bg-blue-500/10'
        )}
      >
        <Eye className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 w-36 card shadow-lg py-1 animate-fade-in"
        >
          <Link
            href={`/plans/${plan.uid}/view`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" /> View
          </Link>
          <Link
            href={`/plans/${plan.uid}`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Pencil className="h-4 w-4 text-slate-500" /> Edit
          </Link>
        </div>
      )}
    </div>
  );
}

function PlanTable({ plans, selected, onToggle, onToggleAll, allSelected }: {
  plans: Plan[]; selected: Set<string>;
  onToggle: (uid: string) => void; onToggleAll: () => void; allSelected: boolean;
}) {
  return (
    <section className="card overflow-visible">
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-[0.1em] text-slate-500 bg-slate-50 border-b border-slate-200 dark:bg-slate-800 dark:border-slate-700 [&_th:first-child]:rounded-tl-xl [&_th:last-child]:rounded-tr-xl">
          <tr>
            <th className="pl-4 pr-2 py-3 w-8">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} className="rounded border-slate-300" />
            </th>
            <th className="text-left px-2 py-3 font-semibold">Plan</th>
            <th className="text-left px-2 py-3 font-semibold">Status</th>
            <th className="text-left px-2 py-3 font-semibold">Type</th>
            <th className="text-left px-2 py-3 font-semibold">Effective</th>
            <th className="text-right px-2 py-3 font-semibold">KPIs</th>
            <th className="text-center pl-2 pr-4 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.uid} className={cn(
              'border-t border-slate-100 hover:bg-slate-50 transition-colors dark:border-slate-800 dark:hover:bg-slate-800/50',
              selected.has(p.uid) && 'bg-primary-50/50 dark:bg-primary-900/10'
            )}>
              <td className="pl-4 pr-2 py-3">
                <input type="checkbox" checked={selected.has(p.uid)} onChange={() => onToggle(p.uid)} className="rounded border-slate-300" />
              </td>
              <td className="px-2 py-3">
                <div className="font-medium text-slate-800 dark:text-slate-100">{p.name}</div>
                {p.description && <div className="text-xs text-slate-500 line-clamp-1">{p.description}</div>}
              </td>
              <td className="px-2 py-3"><StatusPill status={p.status} /></td>
              <td className="px-2 py-3 capitalize text-slate-500">{p.plan_type}</td>
              <td className="px-2 py-3 font-mono text-xs text-slate-500 tabular-nums">{formatDate(p.effective_from)} → {formatDate(p.effective_to)}</td>
              <td className="px-2 py-3 text-right tabular-nums">{p.kpi_count}</td>
              <td className="pl-2 pr-4 py-3 text-center">
                <ActionsMenu plan={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

