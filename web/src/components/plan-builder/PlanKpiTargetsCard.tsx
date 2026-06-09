'use client';
import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';

interface PlanKpiRow {
  uid: string;
  kpi_uid: string;
  kpi_name?: string;
  kpi_code?: string;
  weight: number;
  target_value: number;
  slab_set_uid?: string | null;
  unit?: string;
  direction?: 'higher_is_better' | 'lower_is_better';
}

interface Plan {
  uid: string;
  kpis?: PlanKpiRow[];
}

/**
 * Plan-level KPI target editor. Replaces the old "Who qualifies" eligibility
 * card — the team uses plan-KPI targets the way the previous codebase did.
 *
 * Picker is constrained to KPIs already attached to THIS plan (per user ask:
 * "whatever kpi we select for that plan that only we need to show in dropdown").
 */
export default function PlanKpiTargetsCard({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [draft, setDraft] = useState<PlanKpiRow[]>(plan.kpis ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(plan.kpis ?? []); }, [plan.kpis]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(plan.kpis ?? []);
  const update = (i: number, patch: Partial<PlanKpiRow>) =>
    setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.uid}/kpis`, {
        kpis: draft.map((k) => ({
          kpiUid: k.kpi_uid,
          weight: k.weight,
          targetValue: Number(k.target_value) || 0,
          slabSetUid: k.slab_set_uid ?? null,
        })),
      });
      toast.success('Targets saved');
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (draft.length === 0) {
    return (
      <section className="card p-5">
        <header className="mb-3">
          <h2 className="text-base font-semibold flex items-center gap-1.5">
            <Target className="h-4 w-4 text-muted-foreground" />
            5. KPI targets <Tip k="weight" />
          </h2>
          <p className="text-xs text-fg-muted mt-0.5">
            Set the period target for each KPI on this plan.
          </p>
        </header>
        <p className="text-center py-8 text-sm text-fg-muted">
          No KPIs on this plan yet. Add KPIs from the <strong>KPIs</strong> or <strong>Calculation</strong> tab first — targets will appear here.
        </p>
      </section>
    );
  }

  return (
    <section className="card p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-1.5">
            <Target className="h-4 w-4 text-muted-foreground" />
            5. KPI targets <Tip k="weight" />
          </h2>
          <p className="text-xs text-fg-muted mt-0.5">
            Set the period target for each KPI on this plan. The picker below is restricted to KPIs already attached to this plan.
          </p>
        </div>
        {dirty && (
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">
            {saving ? 'Saving…' : 'Save targets'}
          </button>
        )}
      </header>

      <div className="overflow-hidden border border-slate-200 rounded-lg dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] uppercase tracking-[0.1em] text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-semibold w-2/5">KPI</th>
              <th className="text-left px-3 py-2 font-semibold w-1/5">Weight</th>
              <th className="text-left px-3 py-2 font-semibold w-1/5">Target value</th>
              <th className="text-left px-3 py-2 font-semibold">Direction</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((row, i) => (
              <tr key={row.kpi_uid} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2">
                  {/* Dropdown is constrained to this plan's own KPIs */}
                  <select
                    className="input text-sm w-full"
                    value={row.kpi_uid}
                    onChange={(e) => update(i, { kpi_uid: e.target.value })}
                  >
                    {draft.map((k) => (
                      <option key={k.kpi_uid} value={k.kpi_uid}>
                        {k.kpi_name ?? k.kpi_code ?? k.kpi_uid}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className="input text-sm w-20"
                      value={row.weight}
                      onChange={(e) => update(i, { weight: parseFloat(e.target.value) || 0 })}
                    />
                    <span className="text-xs text-fg-muted">%</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    className="input text-sm w-32"
                    value={row.target_value}
                    onChange={(e) => update(i, { target_value: parseFloat(e.target.value) || 0 })}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-fg-muted">
                  {row.direction === 'lower_is_better' ? 'lower is better' : 'higher is better'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-fg-muted">
        Tip: changing a KPI's target here updates the plan's default. For month-specific overrides use the <strong>Rules</strong> tab.
      </p>
    </section>
  );
}
