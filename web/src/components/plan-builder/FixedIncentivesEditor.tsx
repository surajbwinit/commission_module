'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2, Gift } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';

interface FixedIncentive {
  uid?: string;
  role_uid?: string | null;
  role_name?: string | null;
  period?: string | null;
  name: string;
  amount: number;
  condition_kpi_uid?: string | null;
  condition_kpi_name?: string | null;
  condition_operator?: string | null;
  condition_value?: number | null;
  is_active?: boolean;
}

interface Plan {
  uid: string;
  fixed_incentives?: FixedIncentive[];
  currency_uid?: string;
  currency_code?: string;
}

interface KpiDef { uid: string; name: string; code: string; }
interface Role { uid: string; role_name_en: string; }

const blank = (): FixedIncentive => ({
  role_uid: null,
  period: '',
  name: '',
  amount: 0,
  condition_kpi_uid: null,
  condition_operator: '>=',
  condition_value: 0,
  is_active: true,
});

export default function FixedIncentivesEditor({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [draft, setDraft] = useState<FixedIncentive[]>(plan.fixed_incentives ?? []);
  const [kpis, setKpis] = useState<KpiDef[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(plan.fixed_incentives ?? []); }, [plan.fixed_incentives]);
  useEffect(() => {
    api.get<unknown, KpiDef[]>('/kpis').then(setKpis).catch(() => setKpis([]));
    api.get<unknown, Role[]>('/roles').then(setRoles).catch(() => setRoles([]));
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(plan.fixed_incentives ?? []);

  const update = (i: number, patch: Partial<FixedIncentive>) =>
    setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const remove = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));
  const add = () => setDraft([...draft, blank()]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.uid}/fixed-incentives`, {
        incentives: draft.map((r) => ({
          roleUid: r.role_uid || null,
          period: r.period || null,
          name: r.name,
          amount: Number(r.amount) || 0,
          conditionKpiUid: r.condition_kpi_uid || null,
          conditionOperator: r.condition_operator || '>=',
          conditionValue: r.condition_value == null ? null : Number(r.condition_value),
          isActive: r.is_active ?? true,
        })),
      });
      toast.success('Fixed bonuses saved');
      onChange();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const currency = plan.currency_code;

  return (
    <section className="card p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-1">
            Fixed bonuses <Tip k="fixed_incentive" />
          </h3>
          <p className="text-xs text-fg-muted mt-0.5">
            Flat one-off amounts triggered by a condition (or unconditional, when condition KPI is blank).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button onClick={save} disabled={saving} className="btn-primary btn-sm">
              {saving ? 'Saving…' : 'Save bonuses'}
            </button>
          )}
          <button onClick={add} className="btn-outline btn-sm">
            <Plus className="w-3.5 h-3.5" /> Add bonus
          </button>
        </div>
      </header>

      {draft.length === 0 ? (
        <div className="text-center py-8 text-fg-subtle">
          <Gift className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No fixed bonuses configured.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {draft.map((row, i) => (
            <div key={row.uid ?? i} className="border border-slate-200 rounded-lg p-3 bg-slate-50/60 space-y-2 dark:border-slate-700 dark:bg-slate-800/40">
              <div className="flex items-start gap-2 flex-wrap">
                <label className="flex-1 min-w-[180px]">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Name</span>
                  <input
                    className="input text-sm"
                    value={row.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="e.g. Onboard 5 new customers"
                  />
                </label>
                <label className="w-32">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Amount {currency ? `(${currency})` : ''}</span>
                  <input
                    type="number"
                    className="input text-sm"
                    value={row.amount}
                    onChange={(e) => update(i, { amount: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </label>
                <label className="w-32">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Period (YYYY-MM)</span>
                  <input
                    className="input text-sm"
                    value={row.period ?? ''}
                    onChange={(e) => update(i, { period: e.target.value })}
                    placeholder="all"
                  />
                </label>
                <label className="w-40">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Role (optional)</span>
                  <select
                    className="input text-sm"
                    value={row.role_uid ?? ''}
                    onChange={(e) => update(i, { role_uid: e.target.value || null })}
                  >
                    <option value="">All roles</option>
                    {roles.map((r) => <option key={r.uid} value={r.uid}>{r.role_name_en}</option>)}
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

              <div className="flex items-end gap-2 flex-wrap pt-1 border-t border-line/60">
                <span className="text-2xs text-fg-muted pb-2 mr-2">If</span>
                <label className="w-56">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Condition KPI</span>
                  <select
                    className="input text-sm"
                    value={row.condition_kpi_uid ?? ''}
                    onChange={(e) => update(i, { condition_kpi_uid: e.target.value || null })}
                  >
                    <option value="">— Unconditional —</option>
                    {kpis.map((k) => <option key={k.uid} value={k.uid}>{k.name}</option>)}
                  </select>
                </label>
                <label className="w-20">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Op</span>
                  <select
                    className="input text-sm"
                    value={row.condition_operator ?? '>='}
                    onChange={(e) => update(i, { condition_operator: e.target.value })}
                    disabled={!row.condition_kpi_uid}
                  >
                    <option value=">=">{'>='}</option>
                    <option value="<=">{'<='}</option>
                    <option value=">">{'>'}</option>
                    <option value="<">{'<'}</option>
                    <option value="=">{'='}</option>
                  </select>
                </label>
                <label className="w-24">
                  <span className="block text-2xs uppercase text-fg-muted mb-1">Threshold</span>
                  <input
                    type="number"
                    className="input text-sm"
                    value={row.condition_value ?? ''}
                    onChange={(e) => update(i, { condition_value: e.target.value === '' ? null : Number(e.target.value) })}
                    disabled={!row.condition_kpi_uid}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
