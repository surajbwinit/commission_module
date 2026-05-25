'use client';
import { useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';

interface EligRule {
  id: string;
  metric: string;
  operator: string;
  threshold: number;
  action: string;
  reduction_percent: number;
}

interface Plan {
  id: string;
  eligibility_rules?: EligRule[];
}

const METRIC_LABEL: Record<string, string> = {
  min_sales: 'Minimum monthly sales',
  min_collection_percent: 'Minimum collection %',
  max_return_percent: 'Maximum return %',
  min_active_days: 'Minimum active days',
  min_lines_sold: 'Minimum distinct products sold',
};

const DEFAULT_OP: Record<string, string> = {
  min_sales: '>=',
  min_collection_percent: '>=',
  max_return_percent: '<=',
  min_active_days: '>=',
  min_lines_sold: '>=',
};

export default function EligibilityCard({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [draft, setDraft] = useState<EligRule[]>(plan.eligibility_rules ?? []);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan.eligibility_rules ?? []);

  const setMetric = (metric: string, threshold: number | null) => {
    const without = draft.filter((r) => r.metric !== metric);
    if (threshold == null || isNaN(threshold)) { setDraft(without); return; }
    setDraft([
      ...without,
      { id: '', metric, operator: DEFAULT_OP[metric] ?? '>=', threshold, action: 'zero_payout', reduction_percent: 0 },
    ]);
  };

  const get = (metric: string) => draft.find((r) => r.metric === metric);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/eligibility`, {
        rules: draft.map((r) => ({
          metric: r.metric, operator: r.operator, threshold: r.threshold,
          action: r.action, reductionPercent: r.reduction_percent,
        })),
      });
      toast.success('Qualifiers saved');
      onChange();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <section className="card p-5">
      <header className="mb-3">
        <h2 className="text-base font-semibold flex items-center gap-1">5. Who qualifies <Tip k="eligibility" /></h2>
        <p className="text-xs text-fg-muted mt-0.5">Skip an employee if any of these fail. Leave blank to skip a qualifier.</p>
      </header>

      <div className="grid md:grid-cols-2 gap-3">
        {Object.entries(METRIC_LABEL).map(([metric, label]) => {
          const rule = get(metric);
          return (
            <label key={metric} className="text-sm">
              <span className="block text-xs uppercase text-fg-muted mb-1">{label}</span>
              <input
                type="number"
                className="input w-full"
                value={rule?.threshold ?? ''}
                placeholder="(none)"
                onChange={(e) => setMetric(metric, e.target.value === '' ? null : parseFloat(e.target.value))}
              />
            </label>
          );
        })}
      </div>

      {dirty && (
        <div className="mt-3 flex justify-end">
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">
            {saving ? 'Saving…' : 'Save qualifiers'}
          </button>
        </div>
      )}
    </section>
  );
}
