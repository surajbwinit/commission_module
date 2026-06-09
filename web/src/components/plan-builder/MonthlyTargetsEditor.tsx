'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, CalendarDays } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface MonthlyTarget {
  uid?: string;
  kpi_uid: string;
  kpi_name?: string;
  role_uid?: string | null;
  role_name?: string | null;
  period: string;          // YYYY-MM
  target_value: number;
}

interface Plan {
  uid: string;
  monthly_targets?: MonthlyTarget[];
  kpis?: { kpi_uid: string; kpi_name: string }[];
}

interface Role { uid: string; role_name_en: string; }

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function MonthlyTargetsEditor({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [draft, setDraft] = useState<MonthlyTarget[]>(plan.monthly_targets ?? []);
  const [roles, setRoles] = useState<Role[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(plan.monthly_targets ?? []); }, [plan.monthly_targets]);
  useEffect(() => {
    api.get<unknown, Role[]>('/roles').then(setRoles).catch(() => setRoles([]));
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(plan.monthly_targets ?? []);
  const planKpis = useMemo(() => plan.kpis ?? [], [plan.kpis]);

  const update = (i: number, patch: Partial<MonthlyTarget>) =>
    setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const remove = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));
  const add = () => {
    const firstKpi = planKpis[0];
    if (!firstKpi) { toast.error('Add KPIs to this plan before overriding targets.'); return; }
    setDraft([...draft, {
      kpi_uid: firstKpi.kpi_uid, role_uid: null, period: currentMonth(), target_value: 0,
    }]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.uid}/monthly-targets`, {
        targets: draft.map((r) => ({
          kpiUid: r.kpi_uid,
          roleUid: r.role_uid || null,
          period: r.period,
          targetValue: Number(r.target_value) || 0,
        })),
      });
      toast.success('Monthly targets saved');
      onChange();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <section className="card p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">Monthly target overrides</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Override the plan's default KPI target for a specific month (and optionally a specific role).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button onClick={save} disabled={saving} className="btn-primary btn-sm">
              {saving ? 'Saving…' : 'Save targets'}
            </button>
          )}
          <button onClick={add} className="btn-outline btn-sm" disabled={planKpis.length === 0}>
            <Plus className="w-3.5 h-3.5" /> Add override
          </button>
        </div>
      </header>

      {draft.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No overrides. Plan-level targets apply to every month.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {draft.map((row, i) => (
            <div key={row.uid ?? i} className="flex items-end gap-2 flex-wrap border border-slate-200 rounded-lg p-3 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40">
              <label className="w-32">
                <span className="block text-2xs uppercase text-slate-500 mb-1">Period</span>
                <input
                  type="month"
                  className="input text-sm"
                  value={row.period}
                  onChange={(e) => update(i, { period: e.target.value })}
                />
              </label>
              <label className="w-56">
                <span className="block text-2xs uppercase text-slate-500 mb-1">KPI</span>
                <select
                  className="input text-sm"
                  value={row.kpi_uid}
                  onChange={(e) => update(i, { kpi_uid: e.target.value })}
                >
                  {planKpis.map((k) => <option key={k.kpi_uid} value={k.kpi_uid}>{k.kpi_name}</option>)}
                </select>
              </label>
              <label className="w-44">
                <span className="block text-2xs uppercase text-slate-500 mb-1">Role (optional)</span>
                <select
                  className="input text-sm"
                  value={row.role_uid ?? ''}
                  onChange={(e) => update(i, { role_uid: e.target.value || null })}
                >
                  <option value="">All roles</option>
                  {roles.map((r) => <option key={r.uid} value={r.uid}>{r.role_name_en}</option>)}
                </select>
              </label>
              <label className="w-32">
                <span className="block text-2xs uppercase text-slate-500 mb-1">Target value</span>
                <input
                  type="number"
                  className="input text-sm"
                  value={row.target_value}
                  onChange={(e) => update(i, { target_value: e.target.value === '' ? 0 : Number(e.target.value) })}
                />
              </label>
              <button
                onClick={() => remove(i)}
                className="mb-1 p-1.5 hover:bg-rose-50 rounded text-rose-400"
                aria-label="Remove override"
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
