'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, Pencil, Trash2, TrendingUp, TrendingDown, Target, Sparkles,
} from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import { Badge, PillTabs } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import FormulaBuilder, { type Formula, formulaToPreview } from '@/components/FormulaBuilder';
import PageHero from '@/components/layout/PageHero';

interface Kpi {
  id: string;
  name: string;
  code: string;
  category: string;
  description?: string;
  unit: string;
  direction: 'higher_is_better' | 'lower_is_better';
  formula?: string;
  applicable_roles?: string[];
}

const CATEGORY_COLOR: Record<string, { bg: string; text: string; ring: string }> = {
  Sales:           { bg: 'bg-violet-50 dark:bg-violet-500/10',   text: 'text-violet-700 dark:text-violet-300',   ring: 'ring-violet-200 dark:ring-violet-500/30' },
  Distribution:    { bg: 'bg-sky-50 dark:bg-sky-500/10',         text: 'text-sky-700 dark:text-sky-300',         ring: 'ring-sky-200 dark:ring-sky-500/30' },
  Productivity:    { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-200 dark:ring-emerald-500/30' },
  Financial:       { bg: 'bg-amber-50 dark:bg-amber-500/10',     text: 'text-amber-800 dark:text-amber-300',     ring: 'ring-amber-200 dark:ring-amber-500/30' },
  Merchandising:   { bg: 'bg-rose-50 dark:bg-rose-500/10',       text: 'text-rose-700 dark:text-rose-300',       ring: 'ring-rose-200 dark:ring-rose-500/30' },
  Asset:           { bg: 'bg-cyan-50 dark:bg-cyan-500/10',       text: 'text-cyan-700 dark:text-cyan-300',       ring: 'ring-cyan-200 dark:ring-cyan-500/30' },
  'Trade Marketing': { bg: 'bg-pink-50 dark:bg-pink-500/10',     text: 'text-pink-700 dark:text-pink-300',       ring: 'ring-pink-200 dark:ring-pink-500/30' },
  Inventory:       { bg: 'bg-orange-50 dark:bg-orange-500/10',   text: 'text-orange-700 dark:text-orange-300',   ring: 'ring-orange-200 dark:ring-orange-500/30' },
  Behavioral:      { bg: 'bg-teal-50 dark:bg-teal-500/10',       text: 'text-teal-700 dark:text-teal-300',       ring: 'ring-teal-200 dark:ring-teal-500/30' },
  Delivery:        { bg: 'bg-indigo-50 dark:bg-indigo-500/10',   text: 'text-indigo-700 dark:text-indigo-300',   ring: 'ring-indigo-200 dark:ring-indigo-500/30' },
  Other:           { bg: 'bg-muted',                              text: 'text-foreground',                        ring: 'ring-border' },
};

const colourFor = (c?: string) => CATEGORY_COLOR[c ?? ''] ?? CATEGORY_COLOR.Other;

export default function KpiLibraryPage() {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [editing, setEditing] = useState<Kpi | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    api.get<unknown, Kpi[]>('/kpis')
      .then(setKpis)
      .catch(() => toast.error('Failed to load KPIs'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const k of kpis) map.set(k.category, (map.get(k.category) ?? 0) + 1);
    return Array.from(map.entries()).sort();
  }, [kpis]);

  const visible = useMemo(() => kpis.filter((k) => {
    if (category !== 'all' && k.category !== category) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return k.name.toLowerCase().includes(q) || k.code.toLowerCase().includes(q) || (k.description ?? '').toLowerCase().includes(q);
  }), [kpis, search, category]);

  const remove = async (k: Kpi) => {
    if (!confirm(`Remove KPI "${k.name}"?`)) return;
    try {
      await api.delete(`/kpis/${k.id}`);
      toast.success('KPI removed');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHero
        eyebrow="Setup"
        title="KPI"
        emphasis="library"
        subtitle="Reusable performance indicators — define once, use in many plans."
        actions={
          <button onClick={() => setCreating(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> New KPI
          </button>
        }
      />

      {/* Filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <PillTabs
          value={category}
          onChange={setCategory}
          options={[
            { value: 'all',  label: 'All', count: kpis.length },
            ...categories.map(([c, n]) => ({ value: c, label: c, count: n })),
          ]}
        />
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, code, description…"
            className="input pl-9 w-80"
          />
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No KPIs found"
          description={search ? 'Try changing your search or category filter.' : 'Add a KPI to get started.'}
          action={<button onClick={() => setCreating(true)} className="btn-primary"><Plus className="w-4 h-4" /> Create your first KPI</button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((k) => <KpiCard key={k.id} kpi={k} onEdit={() => setEditing(k)} onRemove={() => remove(k)} />)}
        </div>
      )}

      <KpiModal
        open={creating || !!editing}
        kpi={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { setCreating(false); setEditing(null); load(); }}
      />
    </div>
  );
}

function KpiCard({ kpi, onEdit, onRemove }: { kpi: Kpi; onEdit: () => void; onRemove: () => void }) {
  const c = colourFor(kpi.category);
  const isLower = kpi.direction === 'lower_is_better';
  const DirIcon = isLower ? TrendingDown : TrendingUp;
  const preview = formulaToPreview(safeParse(kpi.formula));
  return (
    <article className="card p-4 group hover:shadow-card-lg hover:-translate-y-0.5 transition-all relative">
      <header className="flex items-start justify-between mb-3">
        <span className={cn('badge ring-inset', c.bg, c.text, c.ring)}>{kpi.category}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="p-1.5 rounded-md text-fg-subtle hover:bg-sunken hover:text-fg" title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onRemove} className="p-1.5 rounded-md text-rose-400 hover:bg-rose-50" title="Remove">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>
      <h3 className="font-semibold text-fg text-sm flex items-center gap-1.5">
        {kpi.name}
        <DirIcon className={cn('w-3.5 h-3.5', isLower ? 'text-rose-500' : 'text-emerald-500')} />
      </h3>
      <code className="block text-2xs font-mono uppercase text-fg-subtle mt-0.5">{kpi.code}</code>
      {kpi.description && <p className="text-xs text-fg-muted mt-2 line-clamp-2">{kpi.description}</p>}
      <div className="mt-3 bg-muted/60 text-foreground border font-mono text-2xs rounded-md px-2.5 py-1.5 leading-relaxed truncate" title={preview}>
        {preview || '— no formula —'}
      </div>
      <div className="mt-3 flex items-center justify-between text-2xs">
        <span className="text-fg-subtle">Unit: <span className="text-fg font-medium">{kpi.unit}</span></span>
        <span className="text-fg-subtle">{isLower ? 'lower is better' : 'higher is better'}</span>
      </div>
    </article>
  );
}

function safeParse(s?: string): Formula | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// ─── Templates ─────────────────────────────────────────────────────
// Each template fills name/code/category/unit/direction/formula in one click.
// Picked from common FMCG distribution KPIs (sales, helpers, financial).
type Template = {
  key: string;
  label: string;
  hint: string;
  category: string;
  unit: string;
  direction: 'higher_is_better' | 'lower_is_better';
  code: string;
  description: string;
  formula: Formula | null;
};

const KPI_TEMPLATES: Template[] = [
  // Helper / unit-based
  {
    key: 'crates_loaded', label: 'Crates loaded', hint: 'Helper — per crate',
    code: 'CRATES_LOADED', category: 'Productivity', unit: 'number', direction: 'higher_is_better',
    description: 'Total crates a helper loaded in the period. Pays per-crate.',
    formula: { type: 'simple', aggregation: 'SUM', field: 'quantity', transactionType: 'crate_load', filters: [] },
  },
  {
    key: 'cases_delivered', label: 'Cases delivered', hint: 'Helper / driver — per case',
    code: 'CASES_DELIVERED', category: 'Delivery', unit: 'number', direction: 'higher_is_better',
    description: 'Total cases delivered in the period. Pays per-case.',
    formula: { type: 'simple', aggregation: 'SUM', field: 'quantity', transactionType: 'case_delivery', filters: [] },
  },
  {
    key: 'pallets_handled', label: 'Pallets handled', hint: 'Helper — per pallet',
    code: 'PALLETS_HANDLED', category: 'Productivity', unit: 'number', direction: 'higher_is_better',
    description: 'Total pallets a helper moved in the period. Pays per-pallet.',
    formula: { type: 'simple', aggregation: 'SUM', field: 'quantity', transactionType: 'pallet_handling', filters: [] },
  },
  // Sales
  {
    key: 'total_revenue', label: 'Total revenue', hint: 'Salesman — sum of sales',
    code: 'TOTAL_REVENUE', category: 'Sales', unit: 'currency', direction: 'higher_is_better',
    description: 'Sum of all sale transactions in the period.',
    formula: { type: 'simple', aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] },
  },
  {
    key: 'new_customers', label: 'New customers', hint: 'Count of distinct buyers',
    code: 'NEW_CUSTOMERS', category: 'Sales', unit: 'number', direction: 'higher_is_better',
    description: 'Distinct customers who bought in the period.',
    formula: { type: 'simple', aggregation: 'COUNT_DISTINCT', field: 'customer_id', transactionType: 'sale', filters: [] },
  },
  // Ratios
  {
    key: 'return_percent', label: 'Return %', hint: 'Lower is better — guardrail',
    code: 'RETURN_PERCENT', category: 'Financial', unit: 'percentage', direction: 'lower_is_better',
    description: 'Returns as a percentage of sales. Reward keeping returns low.',
    formula: { type: 'ratio',
      numerator:   { aggregation: 'SUM', field: 'amount', transactionType: 'return', filters: [] },
      denominator: { aggregation: 'SUM', field: 'amount', transactionType: 'sale',   filters: [] },
      multiplyBy: 100,
    },
  },
  {
    key: 'collection_percent', label: 'Collection %', hint: 'How much got paid vs invoiced',
    code: 'COLLECTION_PERCENT', category: 'Financial', unit: 'percentage', direction: 'higher_is_better',
    description: 'Cash collected divided by sales invoiced.',
    formula: { type: 'ratio',
      numerator:   { aggregation: 'SUM', field: 'amount', transactionType: 'collection', filters: [] },
      denominator: { aggregation: 'SUM', field: 'amount', transactionType: 'sale',       filters: [] },
      multiplyBy: 100,
    },
  },
  // Growth
  {
    key: 'revenue_growth', label: 'Revenue growth %', hint: 'vs previous year',
    code: 'REVENUE_GROWTH', category: 'Sales', unit: 'percentage', direction: 'higher_is_better',
    description: 'Sales growth versus the same period last year.',
    formula: { type: 'growth',
      baseMetric: { aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] },
      compareWith: 'previous_year',
    },
  },
];

function KpiModal({ open, kpi, onClose, onSaved }: { open: boolean; kpi: Kpi | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Partial<Kpi> & { formulaObj?: Formula | null }>({});
  const [saving, setSaving] = useState(false);
  const [showFormula, setShowFormula] = useState(false);
  const isEdit = !!kpi;

  useEffect(() => {
    if (open) {
      setDraft(kpi ? {
        name: kpi.name, code: kpi.code, category: kpi.category, description: kpi.description,
        unit: kpi.unit, direction: kpi.direction,
        formulaObj: safeParse(kpi.formula),
      } : {
        name: '', code: '', category: 'Sales', description: '', unit: 'currency', direction: 'higher_is_better',
        formulaObj: null,
      });
      // For new KPIs start with formula hidden (template handles it).
      // For edits open it so the user can see what's already there.
      setShowFormula(!!kpi);
    }
  }, [open, kpi]);

  const applyTemplate = (t: Template) => {
    setDraft({
      name: t.label,
      code: t.code,
      category: t.category,
      unit: t.unit,
      direction: t.direction,
      description: t.description,
      formulaObj: t.formula,
    });
    setShowFormula(true);
    toast.success(`Template applied: ${t.label}`);
  };

  const save = async () => {
    if (!draft.name || !draft.code) { toast.error('Name and code are required'); return; }
    setSaving(true);
    const payload: any = {
      name: draft.name, code: draft.code, category: draft.category, description: draft.description,
      unit: draft.unit, direction: draft.direction,
      formula: draft.formulaObj ? JSON.stringify(draft.formulaObj) : '',
      applicable_roles: [],
    };
    try {
      if (kpi) await api.put(`/kpis/${kpi.id}`, payload);
      else      await api.post('/kpis', payload);
      toast.success(kpi ? 'KPI updated' : 'KPI created');
      onSaved();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const dirHint = draft.direction === 'lower_is_better'
    ? 'Going UNDER target earns more — e.g. fewer returns, lower overdue.'
    : 'Going OVER target earns more — e.g. more revenue, more crates loaded.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={kpi ? `Edit KPI · ${kpi.name}` : 'New KPI'}
      description="Define a reusable performance KPI. Plans pick from the library and set per-plan weight and target."
      size="xl"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : kpi ? 'Save changes' : 'Create KPI'}
          </button>
        </>
      }
    >
      {/* Template gallery — only for new KPIs */}
      {!isEdit && (
        <section className="mb-5">
          <div className="flex items-center gap-1.5 text-sm font-medium text-fg mb-2">
            <Sparkles className="w-4 h-4 text-primary-500" /> Quick start
          </div>
          <p className="text-xs text-fg-muted mb-3">
            Pick a template — name, code, formula and direction get filled in. You can still edit anything before saving.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {KPI_TEMPLATES.map((t) => {
              const active = draft.code === t.code;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className={cn(
                    'text-left p-3 rounded-lg border transition-colors',
                    active
                      ? 'bg-primary/5 border-primary/40 ring-1 ring-primary/30'
                      : 'bg-surface border-line hover:bg-sunken'
                  )}
                >
                  <div className="text-sm font-medium text-fg">{t.label}</div>
                  <div className="text-2xs text-fg-muted mt-0.5">{t.hint}</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Basic fields */}
      <div className="grid grid-cols-2 gap-4">
        <label>
          <span className="label">Name</span>
          <input className="input" value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>
          <span className="label">Code <span className="text-fg-subtle normal-case">(unique, uppercase)</span></span>
          <input className="input font-mono uppercase" value={draft.code ?? ''} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
        </label>
        <label>
          <span className="label">Category</span>
          <select className="input" value={draft.category ?? 'Sales'} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            {Object.keys(CATEGORY_COLOR).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Unit <span className="text-fg-subtle normal-case">(what kind of number)</span></span>
          <select className="input" value={draft.unit ?? 'currency'} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
            <option value="currency">Currency (SAR, AED)</option>
            <option value="percentage">Percentage (0-100)</option>
            <option value="number">Number (crates, units, count)</option>
          </select>
        </label>
        <label className="col-span-2">
          <span className="label">Description</span>
          <textarea className="input" rows={2} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>

        {/* Direction — clearer labels */}
        <div className="col-span-2">
          <span className="label">When does the employee earn more?</span>
          <div className="flex gap-1.5">
            {([
              { v: 'higher_is_better', l: 'When this number goes UP', sub: 'Sales, crates loaded, new customers', i: TrendingUp,   tone: 'text-emerald-600' },
              { v: 'lower_is_better',  l: 'When this number goes DOWN', sub: 'Returns, overdue %, damages',         i: TrendingDown, tone: 'text-rose-600' },
            ] as const).map((o) => {
              const Icon = o.i; const active = draft.direction === o.v;
              return (
                <button key={o.v} type="button" onClick={() => setDraft({ ...draft, direction: o.v })}
                  className={cn('flex-1 flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-sm transition-colors',
                    active ? 'bg-primary/10 border-primary/40 text-primary' : 'bg-surface border-line text-fg-muted hover:bg-sunken')}>
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Icon className={cn('w-4 h-4', active ? '' : o.tone)} /> {o.l}
                  </span>
                  <span className="text-2xs text-fg-subtle">e.g. {o.sub}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-2xs text-fg-muted italic">{dirHint}</p>
        </div>
      </div>

      {/* Formula — collapsible */}
      <div className="mt-5 border-t border-line/60 pt-4">
        <button
          type="button"
          onClick={() => setShowFormula((v) => !v)}
          className="w-full flex items-center justify-between text-left group"
        >
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg">
            <Sparkles className="w-4 h-4 text-primary-500" />
            Formula <span className="text-fg-subtle font-normal">— how the system computes the value from your data</span>
          </span>
          <span className="text-xs text-fg-muted group-hover:text-fg">{showFormula ? 'Hide' : 'Show'}</span>
        </button>
        {showFormula && (
          <div className="mt-3 animate-fade-in">
            <p className="text-xs text-fg-muted mb-2">
              For most KPIs a template above fills this in. Edit only if you need to change the data source or filters.
            </p>
            <FormulaBuilder
              value={draft.formulaObj ?? null}
              onChange={(f) => setDraft({ ...draft, formulaObj: f })}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
