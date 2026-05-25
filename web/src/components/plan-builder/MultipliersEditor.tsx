'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';

interface MultRule {
  id?: string;
  name: string;
  type: string;
  condition_metric: string;
  condition_operator: string;
  condition_value: number;
  multiplier_value: number;
  stacking_mode: string;
}

interface Plan {
  id: string;
  multiplier_rules?: MultRule[];
}

const TYPE_OPTIONS = [
  { value: 'growth',           label: 'Growth' },
  { value: 'strategic_sku',    label: 'Strategic SKU' },
  { value: 'new_launch',       label: 'New Launch' },
  { value: 'channel_mix',      label: 'Channel Mix' },
  { value: 'collection_speed', label: 'Collection Speed' },
];

const STACKING_OPTIONS = [
  { value: 'multiplicative', label: 'Multiplicative' },
  { value: 'additive',       label: 'Additive' },
  { value: 'highest_only',   label: 'Highest only' },
];

const blank = (): MultRule => ({
  name: '',
  type: 'growth',
  condition_metric: 'revenue_growth_percent',
  condition_operator: '>=',
  condition_value: 0,
  multiplier_value: 1,
  stacking_mode: 'multiplicative',
});

export default function MultipliersEditor({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [draft, setDraft] = useState<MultRule[]>(plan.multiplier_rules ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(plan.multiplier_rules ?? []); }, [plan.multiplier_rules]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(plan.multiplier_rules ?? []);

  const update = (i: number, patch: Partial<MultRule>) =>
    setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const remove = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));
  const add = () => setDraft([...draft, blank()]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/multipliers`, {
        rules: draft.map((r) => ({
          name: r.name,
          type: r.type,
          conditionMetric: r.condition_metric,
          conditionOperator: r.condition_operator,
          conditionValue: Number(r.condition_value) || 0,
          multiplierValue: Number(r.multiplier_value) || 1,
          stackingMode: r.stacking_mode,
        })),
      });
      toast.success('Bonuses saved');
      onChange();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <section className="card p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-1">
            Bonuses <Tip k="multiplier" />
          </h3>
          <p className="text-xs text-fg-muted mt-0.5">
            Multiply the payout when a condition is met — e.g. +15% if revenue grew over 15% YoY.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button onClick={save} disabled={saving} className="btn-primary btn-sm">
              {saving ? 'Saving…' : 'Save bonuses'}
            </button>
          )}
          <button onClick={add} className="btn-outline btn-sm">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </header>

      {draft.length === 0 ? (
        <div className="text-center py-8 text-fg-subtle">
          <Zap className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No bonuses configured.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {draft.map((rule, i) => (
            <div key={rule.id ?? i} className="border border-line rounded-lg p-3 bg-sunken/40 space-y-2">
              <div className="flex items-start gap-2">
                <label className="flex-1">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Name</span>
                  <input
                    className="input text-sm"
                    value={rule.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="e.g. Growth Bonus"
                  />
                </label>
                <label className="w-44">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Type</span>
                  <select
                    className="input text-sm"
                    value={rule.type}
                    onChange={(e) => update(i, { type: e.target.value })}
                  >
                    {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <button
                  onClick={() => remove(i)}
                  className="mt-6 p-1.5 hover:bg-rose-50 rounded text-rose-400"
                  aria-label="Remove bonus"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-end gap-2 flex-wrap">
                <label className="flex-1 min-w-[180px]">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Condition metric</span>
                  <input
                    className="input text-sm font-mono"
                    value={rule.condition_metric}
                    onChange={(e) => update(i, { condition_metric: e.target.value })}
                    placeholder="revenue_growth_percent"
                  />
                </label>
                <label className="w-20">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Op</span>
                  <select
                    className="input text-sm"
                    value={rule.condition_operator}
                    onChange={(e) => update(i, { condition_operator: e.target.value })}
                  >
                    <option value=">=">{'>='}</option>
                    <option value="<=">{'<='}</option>
                    <option value=">">{'>'}</option>
                    <option value="<">{'<'}</option>
                    <option value="=">{'='}</option>
                  </select>
                </label>
                <label className="w-24">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Value</span>
                  <input
                    type="number"
                    className="input text-sm"
                    value={rule.condition_value}
                    onChange={(e) => update(i, { condition_value: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </label>
                <label className="w-28">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Multiplier ×</span>
                  <input
                    type="number"
                    step="0.05"
                    className="input text-sm"
                    value={rule.multiplier_value}
                    onChange={(e) => update(i, { multiplier_value: e.target.value === '' ? 1 : Number(e.target.value) })}
                  />
                </label>
                <label className="w-40">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Stacking</span>
                  <select
                    className="input text-sm"
                    value={rule.stacking_mode}
                    onChange={(e) => update(i, { stacking_mode: e.target.value })}
                  >
                    {STACKING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
