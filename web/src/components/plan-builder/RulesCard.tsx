'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2, Filter as FilterIcon } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Badge } from '@/components/ui/Pill';
import { cn } from '@/lib/utils';

interface Rule {
  uid?: string;
  rule_set_uid?: string;
  dimension: string;
  rule_type: 'include' | 'exclude';
  match_type?: 'exact' | 'category' | 'tag';
  match_values: any[];
  priority?: number;
}

interface RuleSet {
  uid?: string;
  name: string;
  description?: string;
  rules: Rule[];
}

interface Plan {
  uid: string;
  rule_sets?: RuleSet[];
}

const DIMENSIONS = [
  { value: 'product_brand',       label: 'Product brand',       lookup: true },
  { value: 'product_category',    label: 'Product category',    lookup: true },
  { value: 'product_subcategory', label: 'Product subcategory', lookup: true },
  { value: 'product_sku',         label: 'Product (SKU)',       lookup: true },
  { value: 'customer_channel',    label: 'Customer channel',    lookup: true },
  { value: 'customer_group',      label: 'Customer group',      lookup: true },
  { value: 'territory',           label: 'Sales office',        lookup: false },
];

export default function RulesCard({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [draft, setDraft] = useState<RuleSet[]>(plan.rule_sets ?? []);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan.rule_sets ?? []);

  const addRuleSet = () => setDraft([...draft, { name: `Rule set ${draft.length + 1}`, rules: [] }]);
  const removeRuleSet = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));
  const updateRuleSet = (i: number, patch: Partial<RuleSet>) => setDraft(draft.map((rs, idx) => idx === i ? { ...rs, ...patch } : rs));

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.uid}/rules`, {
        ruleSets: draft.map((rs) => ({
          name: rs.name, description: rs.description ?? '',
          rules: rs.rules.map((r) => ({
            dimension: r.dimension, ruleType: r.rule_type,
            matchType: r.match_type ?? 'exact',
            matchValues: r.match_values, priority: r.priority ?? 0,
          })),
        })),
      });
      toast.success('Mapping rules saved');
      onChange();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <section className="card p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2 text-slate-800 dark:text-slate-100"><FilterIcon className="w-4 h-4 text-slate-400" /> Mapping rules</h2>
          <p className="text-xs text-slate-500 mt-0.5">Limit which transactions this plan sees. Include rules narrow the set; exclude rules drop transactions even if included.</p>
        </div>
        {dirty && (
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </header>

      <div className="space-y-3">
        {draft.length === 0 && (
          <div className="text-sm text-fg-subtle italic">No mapping rules. All transactions are included by default.</div>
        )}
        {draft.map((rs, i) => (
          <RuleSetCard key={i} rs={rs} onChange={(p) => updateRuleSet(i, p)} onRemove={() => removeRuleSet(i)} />
        ))}
      </div>

      <button onClick={addRuleSet} className="mt-3 inline-flex items-center gap-1 text-sm text-primary-600 hover:bg-primary-50 px-3 py-1.5 border border-dashed border-primary-300 rounded-lg transition-colors">
        <Plus className="w-4 h-4" /> Add rule set
      </button>
    </section>
  );
}

function RuleSetCard({ rs, onChange, onRemove }: { rs: RuleSet; onChange: (p: Partial<RuleSet>) => void; onRemove: () => void }) {
  const addRule = () => onChange({
    rules: [...rs.rules, { dimension: 'product_category', rule_type: 'include', match_type: 'exact', match_values: [], priority: 0 }],
  });
  const updateRule = (i: number, patch: Partial<Rule>) => onChange({
    rules: rs.rules.map((r, idx) => idx === i ? { ...r, ...patch, ...(patch.dimension && patch.dimension !== r.dimension ? { match_values: [] } : {}) } : r),
  });
  const removeRule = (i: number) => onChange({ rules: rs.rules.filter((_, idx) => idx !== i) });

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-center justify-between mb-3 gap-2">
        <input
          className="input flex-1 text-sm font-medium"
          value={rs.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <Badge tone="soft">{rs.rules.length} rules</Badge>
        <button onClick={onRemove} className="p-1.5 hover:bg-rose-50 rounded text-rose-400">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-1.5">
        {rs.rules.map((r, i) => (
          <RuleRow key={i} rule={r} onChange={(p) => updateRule(i, p)} onRemove={() => removeRule(i)} />
        ))}
        <button onClick={addRule} className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 px-2 py-1 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add rule
        </button>
      </div>
    </div>
  );
}

function RuleRow({ rule, onChange, onRemove }: { rule: Rule; onChange: (p: Partial<Rule>) => void; onRemove: () => void }) {
  const [options, setOptions] = useState<{ value: string | number; label: string }[]>([]);

  useEffect(() => {
    const dim = DIMENSIONS.find((d) => d.value === rule.dimension);
    if (dim?.lookup) {
      api.get<unknown, any[]>(`/lookups/filter-values?field=${rule.dimension}`)
        .then(setOptions)
        .catch(() => setOptions([]));
    } else {
      setOptions([]);
    }
  }, [rule.dimension]);

  const selectedSet = new Set((rule.match_values ?? []).map(String));

  return (
    <div className="flex items-start gap-2">
      <select
        className="input text-xs w-32"
        value={rule.rule_type}
        onChange={(e) => onChange({ rule_type: e.target.value as Rule['rule_type'] })}
      >
        <option value="include">Include</option>
        <option value="exclude">Exclude</option>
      </select>
      <select
        className="input text-xs w-44"
        value={rule.dimension}
        onChange={(e) => onChange({ dimension: e.target.value })}
      >
        {DIMENSIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>
      <div className="flex-1">
        {options.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {options.map((o) => {
              const on = selectedSet.has(String(o.value));
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => {
                    const next = on
                      ? rule.match_values.filter((v) => String(v) !== String(o.value))
                      : [...rule.match_values, o.value];
                    onChange({ match_values: next });
                  }}
                  className={cn(
                    'px-2 py-0.5 rounded-full text-2xs border transition-colors',
                    on
                      ? (rule.rule_type === 'include' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-rose-50 border-rose-300 text-rose-700')
                      : 'bg-surface border-line text-fg-muted hover:bg-sunken'
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        ) : (
          <input
            className="input text-xs"
            placeholder="Enter values, comma-separated"
            value={(rule.match_values ?? []).join(', ')}
            onChange={(e) => onChange({ match_values: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })}
          />
        )}
      </div>
      <button onClick={onRemove} className="p-1 hover:bg-rose-50 rounded text-rose-400">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
