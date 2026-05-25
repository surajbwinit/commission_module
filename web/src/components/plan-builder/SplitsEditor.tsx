'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2, Scissors } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';

interface Participant {
  id?: string;
  role_id: string;
  role_name?: string;
  split_percent: number;
}

interface SplitRule {
  id?: string;
  name: string;
  trigger_condition?: string;
  participants: Participant[];
}

interface Role {
  id: string;
  name: string;
}

interface Plan {
  id: string;
  split_rules?: SplitRule[];
}

const blankRule = (): SplitRule => ({ name: '', trigger_condition: '', participants: [] });
const blankParticipant = (): Participant => ({ role_id: '', split_percent: 0 });

export default function SplitsEditor({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [draft, setDraft] = useState<SplitRule[]>(plan.split_rules ?? []);
  const [roles, setRoles] = useState<Role[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(plan.split_rules ?? []); }, [plan.split_rules]);
  useEffect(() => {
    api.get<unknown, Role[]>('/roles').then(setRoles).catch(() => setRoles([]));
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(plan.split_rules ?? []);

  const updateRule = (i: number, patch: Partial<SplitRule>) =>
    setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeRule = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));
  const addRule = () => setDraft([...draft, blankRule()]);

  const addParticipant = (ruleIdx: number) =>
    updateRule(ruleIdx, { participants: [...draft[ruleIdx].participants, blankParticipant()] });
  const updateParticipant = (ruleIdx: number, partIdx: number, patch: Partial<Participant>) =>
    updateRule(ruleIdx, {
      participants: draft[ruleIdx].participants.map((p, i) => i === partIdx ? { ...p, ...patch } : p),
    });
  const removeParticipant = (ruleIdx: number, partIdx: number) =>
    updateRule(ruleIdx, {
      participants: draft[ruleIdx].participants.filter((_, i) => i !== partIdx),
    });

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/splits`, {
        rules: draft.map((r) => ({
          name: r.name,
          triggerCondition: r.trigger_condition || null,
          participants: r.participants.map((p) => ({
            roleId: p.role_id,
            splitPercent: Number(p.split_percent) || 0,
          })),
        })),
      });
      toast.success('Splits saved');
      onChange();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <section className="card p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-1">
            Role splits <Tip k="split" />
          </h3>
          <p className="text-xs text-fg-muted mt-0.5">
            Divide commission across roles — e.g. supervisor takes 20% of their team-member's earnings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button onClick={save} disabled={saving} className="btn-primary btn-sm">
              {saving ? 'Saving…' : 'Save splits'}
            </button>
          )}
          <button onClick={addRule} className="btn-outline btn-sm">
            <Plus className="w-3.5 h-3.5" /> Add split
          </button>
        </div>
      </header>

      {draft.length === 0 ? (
        <div className="text-center py-8 text-fg-subtle">
          <Scissors className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No splits configured. Commission goes 100% to the earning role.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {draft.map((rule, ri) => {
            const total = rule.participants.reduce((s, p) => s + (Number(p.split_percent) || 0), 0);
            const totalOk = Math.abs(total - 100) < 0.001;
            return (
              <div key={rule.id ?? ri} className="border border-line rounded-lg p-4 bg-sunken/40 space-y-3">
                <div className="flex items-start gap-2">
                  <label className="flex-1">
                    <span className="block text-2xs uppercase text-fg-muted mb-1">Name</span>
                    <input
                      className="input text-sm font-medium"
                      value={rule.name}
                      onChange={(e) => updateRule(ri, { name: e.target.value })}
                      placeholder="e.g. SR / Supervisor split"
                    />
                  </label>
                  <label className="flex-1">
                    <span className="block text-2xs uppercase text-fg-muted mb-1">Trigger condition (optional)</span>
                    <input
                      className="input text-sm"
                      value={rule.trigger_condition ?? ''}
                      onChange={(e) => updateRule(ri, { trigger_condition: e.target.value })}
                      placeholder="Always applies if blank"
                    />
                  </label>
                  <button
                    onClick={() => removeRule(ri)}
                    className="mt-6 p-1.5 hover:bg-rose-50 rounded text-rose-400"
                    aria-label="Remove split"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  {rule.participants.map((p, pi) => (
                    <div key={p.id ?? pi} className="flex items-center gap-2">
                      <select
                        className="input text-sm w-56"
                        value={p.role_id}
                        onChange={(e) => updateParticipant(ri, pi, { role_id: e.target.value })}
                      >
                        <option value="">Select role…</option>
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      <input
                        type="number"
                        className="input text-sm w-24"
                        value={p.split_percent}
                        onChange={(e) => updateParticipant(ri, pi, { split_percent: e.target.value === '' ? 0 : Number(e.target.value) })}
                        placeholder="%"
                      />
                      <span className="text-xs text-fg-subtle">%</span>
                      <button
                        onClick={() => removeParticipant(ri, pi)}
                        className="p-1 hover:bg-rose-50 rounded text-rose-400 ml-1"
                        aria-label="Remove participant"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1">
                    <button
                      onClick={() => addParticipant(ri)}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 px-2 py-1 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add participant
                    </button>
                    {rule.participants.length > 0 && (
                      <span className={
                        'text-2xs px-2 py-0.5 rounded ' +
                        (totalOk ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')
                      }>
                        Total: {total.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
