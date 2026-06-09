'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';

interface CapRule {
  uid?: string;
  cap_type: string;
  cap_value: number;
}

interface Plan {
  uid: string;
  capping_rules?: CapRule[];
  currency_uid?: string;
  currency_code?: string;
}

const CAP_TYPES = [
  { value: 'max_per_plan',      label: 'Max per plan',     hint: 'Hard ceiling per employee per period' },
  { value: 'percent_of_salary', label: '% of base salary', hint: 'Cap as a percentage of monthly salary' },
  { value: 'max_per_kpi',       label: 'Max per KPI',      hint: 'Cap each KPI sub-payout' },
];

const blank = (): CapRule => ({ cap_type: 'max_per_plan', cap_value: 0 });

export default function CapsEditor({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [draft, setDraft] = useState<CapRule[]>(plan.capping_rules ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(plan.capping_rules ?? []); }, [plan.capping_rules]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(plan.capping_rules ?? []);

  const update = (i: number, patch: Partial<CapRule>) =>
    setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const remove = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));
  const add = () => setDraft([...draft, blank()]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.uid}/caps`, {
        rules: draft.map((r) => ({ capType: r.cap_type, capValue: Number(r.cap_value) || 0 })),
      });
      toast.success('Caps saved');
      onChange();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const currency = plan.currency_code;  // may be undefined — UI handles it

  return (
    <section className="card p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-1">
            Maximum payout <Tip k="capping" />
          </h3>
          <p className="text-xs text-fg-muted mt-0.5">
            Multiple caps stack — the most restrictive wins.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button onClick={save} disabled={saving} className="btn-primary btn-sm">
              {saving ? 'Saving…' : 'Save caps'}
            </button>
          )}
          <button onClick={add} className="btn-outline btn-sm">
            <Plus className="w-3.5 h-3.5" /> Add cap
          </button>
        </div>
      </header>

      {draft.length === 0 ? (
        <div className="text-center py-8 text-fg-subtle">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No caps configured. Payout is uncapped.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {draft.map((cap, i) => {
            const meta = CAP_TYPES.find((c) => c.value === cap.cap_type);
            const isPercent = cap.cap_type === 'percent_of_salary';
            return (
              <div key={cap.uid ?? i} className="flex items-end gap-2 border border-slate-200 rounded-lg p-3 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40">
                <label className="w-48">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Cap type</span>
                  <select
                    className="input text-sm"
                    value={cap.cap_type}
                    onChange={(e) => update(i, { cap_type: e.target.value })}
                  >
                    {CAP_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
                <label className="w-40">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">
                    Value {isPercent ? '(%)' : currency ? `(${currency})` : ''}
                  </span>
                  <input
                    type="number"
                    className="input text-sm"
                    value={cap.cap_value}
                    onChange={(e) => update(i, { cap_value: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </label>
                <div className="flex-1 text-xs text-fg-muted pb-2">{meta?.hint}</div>
                <button
                  onClick={() => remove(i)}
                  className="mb-1 p-1.5 hover:bg-rose-50 rounded text-rose-400"
                  aria-label="Remove cap"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
