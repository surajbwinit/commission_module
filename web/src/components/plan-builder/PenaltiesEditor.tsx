'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface PenaltyRule {
  id?: string;
  name: string;
  trigger_metric: string;
  trigger_operator: string;
  trigger_value: number;
  penalty_type: string;
  penalty_value: number;
}

interface Plan {
  id: string;
  penalty_rules?: PenaltyRule[];
}

const METRIC_HINTS = [
  { value: 'return_percent',         label: 'Return %' },
  { value: 'overdue_percent',        label: 'Overdue %' },
  { value: 'collection_percent',     label: 'Collection %' },
  { value: 'achievement_percent',    label: 'Achievement %' },
  { value: 'damage_percent',         label: 'Damage %' },
];

const PENALTY_TYPES = [
  { value: 'percentage',     label: 'Percentage (%)' },
  { value: 'fixed',          label: 'Fixed amount' },
  { value: 'slab_downgrade', label: 'Slab downgrade' },
];

const blank = (): PenaltyRule => ({
  name: '',
  trigger_metric: 'return_percent',
  trigger_operator: '>',
  trigger_value: 0,
  penalty_type: 'percentage',
  penalty_value: 0,
});

export default function PenaltiesEditor({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [draft, setDraft] = useState<PenaltyRule[]>(plan.penalty_rules ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(plan.penalty_rules ?? []); }, [plan.penalty_rules]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(plan.penalty_rules ?? []);

  const update = (i: number, patch: Partial<PenaltyRule>) =>
    setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const remove = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));
  const add = () => setDraft([...draft, blank()]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/penalties`, {
        rules: draft.map((r) => ({
          name: r.name,
          triggerMetric: r.trigger_metric,
          triggerOperator: r.trigger_operator,
          triggerValue: Number(r.trigger_value) || 0,
          penaltyType: r.penalty_type,
          penaltyValue: Number(r.penalty_value) || 0,
        })),
      });
      toast.success('Penalties saved');
      onChange();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <section className="card p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold">Penalties</h3>
          <p className="text-xs text-fg-muted mt-0.5">
            Reduce payout when a guardrail metric is breached — e.g. return % above 2%.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button onClick={save} disabled={saving} className="btn-primary btn-sm">
              {saving ? 'Saving…' : 'Save penalties'}
            </button>
          )}
          <button onClick={add} className="btn-outline btn-sm">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </header>

      {draft.length === 0 ? (
        <div className="text-center py-8 text-fg-subtle">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No penalties configured.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {draft.map((rule, i) => (
            <div key={rule.id ?? i} className="flex items-end gap-2 flex-wrap border border-line rounded-lg p-3 bg-sunken/40">
              <label className="flex-1 min-w-[180px]">
                <span className="block text-2xs uppercase text-fg-muted mb-1">Name</span>
                <input
                  className="input text-sm"
                  value={rule.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Penalty name"
                />
              </label>
              <label className="w-44">
                <span className="block text-2xs uppercase text-fg-muted mb-1">Trigger metric</span>
                <input
                  className="input text-sm font-mono"
                  list={`penalty-metrics-${i}`}
                  value={rule.trigger_metric}
                  onChange={(e) => update(i, { trigger_metric: e.target.value })}
                />
                <datalist id={`penalty-metrics-${i}`}>
                  {METRIC_HINTS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </datalist>
              </label>
              <label className="w-20">
                <span className="block text-2xs uppercase text-fg-muted mb-1">Op</span>
                <select
                  className="input text-sm"
                  value={rule.trigger_operator}
                  onChange={(e) => update(i, { trigger_operator: e.target.value })}
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
                  value={rule.trigger_value}
                  onChange={(e) => update(i, { trigger_value: e.target.value === '' ? 0 : Number(e.target.value) })}
                />
              </label>
              <label className="w-40">
                <span className="block text-2xs uppercase text-fg-muted mb-1">Penalty</span>
                <select
                  className="input text-sm"
                  value={rule.penalty_type}
                  onChange={(e) => update(i, { penalty_type: e.target.value })}
                >
                  {PENALTY_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="w-24">
                <span className="block text-2xs uppercase text-fg-muted mb-1">Amount</span>
                <input
                  type="number"
                  className="input text-sm"
                  value={rule.penalty_value}
                  onChange={(e) => update(i, { penalty_value: e.target.value === '' ? 0 : Number(e.target.value) })}
                />
              </label>
              <button
                onClick={() => remove(i)}
                className="mb-1 p-1.5 hover:bg-rose-50 rounded text-rose-400"
                aria-label="Remove penalty"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
