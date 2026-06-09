'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

// →·→·→· Constants →·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·
const AGGREGATIONS = [
  { value: 'SUM', label: 'SUM' },
  { value: 'COUNT_DISTINCT', label: 'COUNT DISTINCT' },
  { value: 'AVG', label: 'AVG' },
  { value: 'COUNT', label: 'COUNT' },
];
const FIELDS = [
  { value: 'amount', label: 'Amount' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'customer_uid', label: 'Customer' },
  { value: 'product_uid', label: 'Product (SKU)' },
];
const TX_TYPES = [
  { value: 'sale',                  label: 'Sale' },
  { value: 'return',                label: 'Return' },
  { value: 'bad_return',            label: 'Bad Return' },
  { value: 'collection',            label: 'Collection' },
  { value: 'target',                label: 'Target (from ETL)' },
  { value: 'overdue',               label: 'Overdue' },
  { value: 'outstanding',           label: 'Outstanding' },
  { value: 'visit',                 label: 'Visit (per schedule)' },
  { value: 'visit_outside_schedule', label: 'Visit (outside schedule)' },
  { value: 'scheduled_visit',       label: 'Scheduled visit' },
  { value: 'zero_sales_customer',   label: 'Zero-sales customer' },
  { value: 'ir_audit',              label: 'IR audit' },
  { value: 'crate_load',            label: 'Crate load (helper)' },
  { value: 'case_delivery',         label: 'Case delivery (helper / driver)' },
  { value: 'pallet_handling',       label: 'Pallet handling (helper)' },
  { value: 'event',                 label: 'Event' },
];
const FILTER_FIELDS = [
  { value: 'product_category', label: 'Product Category' },
  { value: 'product_sku', label: 'Product (SKU)' },
  { value: 'is_strategic', label: 'Is Strategic' },
  { value: 'is_new_launch', label: 'Is New Launch' },
  { value: 'customer_channel', label: 'Customer Channel' },
  { value: 'customer_group', label: 'Customer Group' },
];
const FILTER_OPERATORS = [
  { value: '=', label: '=' },
  { value: '!=', label: '!=' },
  { value: 'in', label: 'IN' },
  { value: 'not_in', label: 'NOT IN' },
];
const FORMULA_TYPES = [
  { value: 'simple', label: 'Simple', desc: 'Aggregate filtered transactions' },
  { value: 'ratio',  label: 'Ratio',  desc: 'Numerator ÷ Denominator' },
  { value: 'growth', label: 'Growth', desc: 'Current vs previous period' },
  { value: 'team',   label: 'Team',   desc: 'Aggregate direct reports' },
  { value: 'static', label: 'Static', desc: 'Fixed value / external' },
] as const;
const COMPARE_OPTIONS = [
  { value: 'previous_year',  label: 'Previous year' },
  { value: 'previous_month', label: 'Previous month' },
];
const TEAM_AGG_OPTIONS = [
  { value: 'SUM',   label: 'SUM' },
  { value: 'AVG',   label: 'AVG' },
  { value: 'COUNT', label: 'COUNT' },
];

const LOOKUP_FIELDS = new Set([
  'product_category', 'product_sku', 'customer_channel', 'customer_group', 'is_strategic', 'is_new_launch',
]);

// →·→·→· Types →·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·
export type Filter = { field: string; operator: string; value: unknown };
export type Metric = {
  aggregation: string;
  field: string;
  /** Single transaction type (legacy). */
  transactionType?: string;
  /** Multi-type aggregation. If present, takes precedence over transactionType. */
  transactionTypes?: string[];
  filters: Filter[];
};
export type Formula =
  | ({ type: 'simple' } & Metric)
  | { type: 'ratio'; numerator: Metric; denominator: Metric; multiplyBy: number }
  | { type: 'growth'; baseMetric: Metric; compareWith: string }
  | { type: 'team'; baseMetric: Metric; teamAggregation: string }
  | { type: 'static'; defaultValue: number; source: string };

const defaultMetric = (): Metric => ({
  aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [],
});
const defaultFormula = (): Formula => ({
  type: 'simple', ...defaultMetric(),
});

// →·→·→· Sub: filter value input (smart based on field) →·→·→·→·→·→·→·→·→·→·→·→·
function FilterValueInput({ field, operator, value, onChange }: {
  field: string; operator: string; value: unknown; onChange: (v: unknown) => void;
}) {
  const [options, setOptions] = useState<{ value: string | number; label: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const isMulti = operator === 'in' || operator === 'not_in';

  useEffect(() => {
    if (LOOKUP_FIELDS.has(field)) {
      api.get<unknown, any[]>(`/lookups/filter-values?field=${field}`)
        .then((data) => { setOptions(data); setLoaded(true); })
        .catch(() => setLoaded(true));
    }
  }, [field]);

  if (isMulti && loaded && options.length > 0) {
    const selected = Array.isArray(value) ? value.map(String) : value != null ? [String(value)] : [];
    return (
      <select
        multiple
        size={Math.min(options.length, 4)}
        className="input text-xs flex-1"
        value={selected}
        onChange={(e) => {
          const vals = Array.from(e.target.selectedOptions).map((o) => {
            const v = o.value;
            return !isNaN(Number(v)) && v !== '' ? Number(v) : v;
          });
          onChange(vals);
        }}
      >
        {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  if (loaded && options.length > 0) {
    return (
      <select
        className="input text-xs flex-1"
        value={value == null ? '' : String(value)}
        onChange={(e) => {
          let v: string | number = e.target.value;
          if (!isNaN(Number(v)) && v !== '') v = Number(v);
          onChange(v);
        }}
      >
        <option value="">→ select →</option>
        {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  return (
    <input
      className="input text-xs flex-1"
      value={typeof value === 'object' ? JSON.stringify(value) : value == null ? '' : String(value)}
      onChange={(e) => {
        let val: any = e.target.value;
        if (!isNaN(Number(val)) && val !== '') val = Number(val);
        else { try { const p = JSON.parse(val); if (Array.isArray(p)) val = p; } catch {} }
        onChange(val);
      }}
      placeholder="value"
    />
  );
}

// Sub: metric block
function MetricBlock({ metric, onChange, label }: {
  metric: Metric; onChange: (m: Metric) => void; label?: string;
}) {
  const update = (k: keyof Metric, v: any) => onChange({ ...metric, [k]: v });
  const addFilter = () => onChange({
    ...metric, filters: [...(metric.filters || []), { field: 'product_category', operator: '=', value: '' }],
  });
  const updateFilter = (idx: number, k: keyof Filter, v: any) => {
    const filters = [...(metric.filters || [])];
    filters[idx] = { ...filters[idx], [k]: v };
    if (k === 'field') filters[idx].value = '';
    onChange({ ...metric, filters });
  };
  const removeFilter = (idx: number) => onChange({
    ...metric, filters: (metric.filters || []).filter((_, i) => i !== idx),
  });

  return (
    <div className="border border-line rounded-xl p-3.5 space-y-3 bg-sunken/40">
      {label && <div className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">{label}</div>}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-2xs uppercase text-fg-subtle font-medium">Aggregation</label>
          <select className="input text-sm mt-1" value={metric.aggregation} onChange={(e) => update('aggregation', e.target.value)}>
            {AGGREGATIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-2xs uppercase text-fg-subtle font-medium">Field</label>
          <select className="input text-sm mt-1" value={metric.field} onChange={(e) => update('field', e.target.value)}>
            {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-2xs uppercase text-fg-subtle font-medium">Transaction type(s)</label>
          {/* Multi-select pill picker: click a type to toggle. Shows what's
              actually stored, including multi-type like ['sale','return']. */}
          <div className="flex flex-wrap gap-1 mt-1 p-1.5 border border-slate-200 rounded-md bg-white min-h-[36px] dark:bg-slate-900 dark:border-slate-700">
            {TX_TYPES.map((t) => {
              const selected = (metric.transactionTypes && metric.transactionTypes.length > 0)
                ? metric.transactionTypes.includes(t.value)
                : metric.transactionType === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    const current = metric.transactionTypes && metric.transactionTypes.length > 0
                      ? [...metric.transactionTypes]
                      : (metric.transactionType ? [metric.transactionType] : []);
                    const next = selected ? current.filter((v) => v !== t.value) : [...current, t.value];
                    // Store as array when multiple, single string when one, undefined when empty.
                    if (next.length > 1) onChange({ ...metric, transactionType: undefined, transactionTypes: next });
                    else if (next.length === 1) onChange({ ...metric, transactionType: next[0], transactionTypes: undefined });
                    else onChange({ ...metric, transactionType: undefined, transactionTypes: undefined });
                  }}
                  className={cn(
                    'px-2 py-0.5 rounded text-2xs font-medium border transition-colors',
                    selected
                      ? 'bg-primary-50 border-primary-300 text-primary-700'
                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 dark:bg-transparent dark:border-slate-700 dark:text-slate-400'
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-2xs uppercase tracking-wide text-fg-subtle font-medium">Filters (product / customer hierarchy)</span>
          <button type="button" onClick={addFilter} className="text-xs text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add filter
          </button>
        </div>
        {(metric.filters || []).length === 0 && (
          <div className="text-xs text-fg-subtle italic">No filters → includes all transactions of the selected type.</div>
        )}
        {(metric.filters || []).map((f, idx) => (
          <div key={idx} className="flex items-center gap-1.5 mb-1.5">
            <select className="input text-xs w-40" value={f.field} onChange={(e) => updateFilter(idx, 'field', e.target.value)}>
              {FILTER_FIELDS.map((ff) => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select className="input text-xs w-16" value={f.operator} onChange={(e) => updateFilter(idx, 'operator', e.target.value)}>
              {FILTER_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <FilterValueInput field={f.field} operator={f.operator} value={f.value} onChange={(v) => updateFilter(idx, 'value', v)} />
            <button type="button" onClick={() => removeFilter(idx)} className="p-1 hover:bg-rose-50 rounded text-rose-400">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// →·→·→· Preview →·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·
function FormulaPreview({ formula }: { formula: Formula }) {
  const text = formulaToPreview(formula);
  return (
    <div className="bg-muted/60 text-foreground border rounded-md px-4 py-2.5 font-mono text-xs leading-relaxed">
      <div className="text-2xs text-fg-muted uppercase tracking-wider mb-1">Formula preview</div>
      {text || <span className="text-fg-muted">Configure above…</span>}
    </div>
  );
}

function metricPreview(m?: Metric) {
  if (!m) return '…';
  const filters = (m.filters || []).map((f) => `${f.field}${f.operator}${typeof f.value === 'object' ? JSON.stringify(f.value) : f.value}`);
  // Multi-type takes precedence over single transactionType (matches engine behavior).
  let typeClause = '';
  if (m.transactionTypes && m.transactionTypes.length > 1) {
    typeClause = `type IN (${m.transactionTypes.join(', ')})`;
  } else if (m.transactionTypes && m.transactionTypes.length === 1 && m.transactionTypes[0] !== 'all') {
    typeClause = `type=${m.transactionTypes[0]}`;
  } else if (m.transactionType && m.transactionType !== 'all') {
    typeClause = `type=${m.transactionType}`;
  }
  const where = [typeClause, ...filters].filter(Boolean).join(' AND ');
  return `${m.aggregation || 'SUM'}(${m.field || 'amount'})${where ? ' WHERE ' + where : ''}`;
}

export function formulaToPreview(formula: Formula | null): string {
  if (!formula || !formula.type) return '';
  switch (formula.type) {
    case 'simple': return metricPreview(formula);
    case 'ratio': {
      const n = metricPreview(formula.numerator);
      const d = metricPreview(formula.denominator);
      const mult = formula.multiplyBy && formula.multiplyBy !== 1 ? ` × ${formula.multiplyBy}` : '';
      return `(${n} / ${d})${mult}`;
    }
    case 'growth':
      return `Growth of ${metricPreview(formula.baseMetric)} vs ${(formula.compareWith || 'previous_year').replace(/_/g, ' ')}`;
    case 'team':
      return `${(formula as any).teamAggregation || 'SUM'} of team's ${metricPreview((formula as any).baseMetric)}`;
    case 'static': {
      const src = (formula as any).source;
      if (src === 'external')  return 'External system feed';
      if (src === 'manual')    return 'Manually entered each period';
      if (src === 'placeholder') return 'Placeholder — to be configured';
      return `Static: ${(formula as any).defaultValue ?? 0}${src ? ` (${src})` : ''}`;
    }
    default: return '';
  }
}

// →·→·→· Main →·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·→·
export default function FormulaBuilder({ value, onChange }: {
  value: Formula | null;
  onChange: (f: Formula) => void;
}) {
  const formula: Formula = value && (value as any).type ? value : defaultFormula();

  // Sync the rendered default into parent state so a user who just opens the
  // builder (without clicking anything) still saves a valid formula.
  useEffect(() => {
    if (!value || !(value as any).type) onChange(defaultFormula());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setType = (type: Formula['type']) => {
    switch (type) {
      case 'simple':  onChange({ type: 'simple', ...defaultMetric() }); break;
      case 'ratio':   onChange({ type: 'ratio', numerator: defaultMetric(), denominator: defaultMetric(), multiplyBy: 1 }); break;
      case 'growth':  onChange({ type: 'growth', baseMetric: defaultMetric(), compareWith: 'previous_year' }); break;
      case 'team':    onChange({ type: 'team', baseMetric: defaultMetric(), teamAggregation: 'SUM' }); break;
      case 'static':  onChange({ type: 'static', defaultValue: 0, source: 'external' }); break;
    }
  };

  return (
    <div className="space-y-3">
      {/* Type picker */}
      <div>
        <label className="label">Formula type</label>
        <div className="flex flex-wrap gap-1.5">
          {FORMULA_TYPES.map((ft) => (
            <button
              key={ft.value}
              type="button"
              onClick={() => setType(ft.value)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                formula.type === ft.value
                  ? 'bg-primary-50 border-primary-300 text-primary-700 ring-1 ring-primary-200/60'
                  : 'bg-surface border-line text-fg-muted hover:bg-sunken hover:text-fg'
              )}
              title={ft.desc}
            >
              {ft.label}
            </button>
          ))}
        </div>
      </div>

      {/* Type-specific config */}
      {formula.type === 'simple' && (
        <MetricBlock metric={formula} onChange={(m) => onChange({ ...m, type: 'simple' })} />
      )}

      {formula.type === 'ratio' && (
        <div className="space-y-2">
          <MetricBlock label="Numerator"   metric={formula.numerator}   onChange={(m) => onChange({ ...formula, numerator: m })} />
          <div className="flex items-center justify-center">
            <div className="h-px flex-1 bg-neutral-200" />
            <span className="px-3 text-xs text-fg-subtle font-medium">÷ divided by</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>
          <MetricBlock label="Denominator" metric={formula.denominator} onChange={(m) => onChange({ ...formula, denominator: m })} />
          <div>
            <label className="text-2xs uppercase text-fg-subtle font-medium">Multiply by</label>
            <input type="number" className="input text-sm w-32 mt-1" value={formula.multiplyBy ?? 1}
              onChange={(e) => onChange({ ...formula, multiplyBy: Number(e.target.value) || 1 })} />
          </div>
        </div>
      )}

      {formula.type === 'growth' && (
        <div className="space-y-2">
          <MetricBlock label="Base metric" metric={formula.baseMetric} onChange={(m) => onChange({ ...formula, baseMetric: m })} />
          <div>
            <label className="text-2xs uppercase text-fg-subtle font-medium">Compare with</label>
            <select className="input text-sm mt-1" value={formula.compareWith || 'previous_year'} onChange={(e) => onChange({ ...formula, compareWith: e.target.value })}>
              {COMPARE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {formula.type === 'team' && (
        <div className="space-y-2">
          <MetricBlock label="Per-member metric" metric={formula.baseMetric} onChange={(m) => onChange({ ...formula, baseMetric: m })} />
          <div>
            <label className="text-2xs uppercase text-fg-subtle font-medium">Team aggregation</label>
            <select className="input text-sm mt-1" value={formula.teamAggregation || 'SUM'} onChange={(e) => onChange({ ...formula, teamAggregation: e.target.value })}>
              {TEAM_AGG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {formula.type === 'static' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-2xs uppercase text-fg-subtle font-medium">Default value</label>
            <input type="number" className="input text-sm mt-1" value={formula.defaultValue ?? 0}
              onChange={(e) => onChange({ ...formula, defaultValue: Number(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="text-2xs uppercase text-fg-subtle font-medium">Source</label>
            <select className="input text-sm mt-1" value={formula.source || 'external'} onChange={(e) => onChange({ ...formula, source: e.target.value })}>
              <option value="external">External</option>
              <option value="manual">Manual</option>
              <option value="placeholder">Placeholder</option>
            </select>
          </div>
        </div>
      )}

      <FormulaPreview formula={formula} />
    </div>
  );
}
