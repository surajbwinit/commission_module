'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';
import DeductionBands, { type DeductionBandInput } from './DeductionBands';

interface Plan {
  uid: string;
  kpis?: { uid: string; kpi_uid: string; kpi_name: string; kpi_code: string; weight: number; target_value: number; direction?: string; unit?: string }[];
  kpi_deduction_rules?: {
    uid: string; kpi_uid: string; kpi_name?: string; kpi_code?: string; role_uid: string | null;
    metric_type: 'shortfall_percent' | 'achievement_percent' | 'actual_value';
    min_value: number | null; max_value: number | null;
    min_inclusive: boolean; max_inclusive: boolean;
    deduction_percent: number; priority: number; name?: string;
  }[];
}

interface KpiDef { uid: string; name: string; code: string; category: string; direction: string; }

/**
 * "Targets they must maintain" → combines monitor KPIs (weight=0) and their deduction bands.
 * Failing these reduces the final payout.
 */
export default function MonitorMetricsCard({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [library, setLibrary] = useState<KpiDef[]>([]);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    api.get<unknown, KpiDef[]>('/kpis').then(setLibrary).catch(() => setLibrary([]));
  }, []);

  const monitorKpis = (plan.kpis ?? []).filter((k) => k.weight === 0);
  const dedsFor = (kpiUid: string) =>
    (plan.kpi_deduction_rules ?? []).filter((d) => d.kpi_uid === kpiUid);

  const saveDeductions = async (allRules: { kpi_uid: string; bands: DeductionBandInput[] }[]) => {
    const flat: any[] = [];
    for (const r of allRules) {
      for (const b of r.bands) {
        flat.push({
          kpiUid: r.kpi_uid,
          name: b.name ?? '',
          metricType: b.metric_type ?? 'actual_value',
          minValue: b.min_value, maxValue: b.max_value,
          minInclusive: b.min_inclusive ?? true, maxInclusive: b.max_inclusive ?? true,
          deductionPercent: b.deduction_percent,
        });
      }
    }
    await api.put(`/plans/${plan.uid}/kpi-deductions`, { rules: flat });
  };

  const addMonitor = async (kpiUid: string) => {
    setPicker(false);
    const next = [...(plan.kpis ?? []), {
      uid: '', kpi_uid: kpiUid,
      kpi_name: library.find((l) => l.uid === kpiUid)?.name ?? '',
      kpi_code: library.find((l) => l.uid === kpiUid)?.code ?? '',
      weight: 0, target_value: 100,
    }];
    try {
      await api.put(`/plans/${plan.uid}/kpis`, {
        kpis: next.map((k) => ({
          kpiUid: k.kpi_uid, weight: k.weight, targetValue: k.target_value, slabSetUid: null,
        })),
      });
      toast.success('Monitor metric added');
      onChange();
    } catch (e: any) { toast.error(e.message); }
  };

  const removeMonitor = async (kpiUid: string) => {
    const remaining = (plan.kpis ?? []).filter((k) => k.kpi_uid !== kpiUid);
    try {
      await api.put(`/plans/${plan.uid}/kpis`, {
        kpis: remaining.map((k) => ({
          kpiUid: k.kpi_uid, weight: k.weight, targetValue: k.target_value, slabSetUid: null,
        })),
      });
      const remainingByKpi = monitorKpis.filter((k) => k.kpi_uid !== kpiUid).map((k) => ({
        kpi_uid: k.kpi_uid,
        bands: dedsFor(k.kpi_uid).map(toBand),
      }));
      await saveDeductions(remainingByKpi);
      toast.success('Monitor metric removed');
      onChange();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <section className="card p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">4. Targets they must maintain</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Metrics that don't drive payout, but failing them reduces the final amount.
          <Tip k="kpi_deduction" className="ml-1" />
        </p>
      </header>

      <div className="space-y-3">
        {monitorKpis.map((k) => (
          <MonitorKpiCard
            key={k.kpi_uid}
            kpi={k}
            initialBands={dedsFor(k.kpi_uid).map(toBand)}
            onSaveBands={async (newBands) => {
              const byKpi = monitorKpis.map((mk) => ({
                kpi_uid: mk.kpi_uid,
                bands: mk.kpi_uid === k.kpi_uid ? newBands : dedsFor(mk.kpi_uid).map(toBand),
              }));
              await saveDeductions(byKpi);
              onChange();
            }}
            onRemove={() => removeMonitor(k.kpi_uid)}
          />
        ))}

        {monitorKpis.length === 0 && (
          <div className="text-sm text-slate-500 italic">No monitor metrics yet.</div>
        )}
      </div>

      <div className="mt-4 relative">
        <button onClick={() => setPicker((v) => !v)}
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:bg-primary-50 px-3 py-1.5 border border-dashed border-primary-300 rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Add monitor metric
        </button>
        {picker && (
          <div className="absolute top-full mt-1 z-10 w-96 card shadow-lg max-h-72 overflow-y-auto">
            {library
              .filter((l) => !(plan.kpis ?? []).some((k) => k.kpi_uid === l.uid))
              .map((l) => (
                <button key={l.uid} onClick={() => addMonitor(l.uid)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 dark:hover:bg-slate-800 dark:border-slate-800">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{l.name}</div>
                  <div className="text-xs text-slate-500">{l.category} · {l.code}</div>
                </button>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MonitorKpiCard({
  kpi, initialBands, onSaveBands, onRemove,
}: {
  kpi: { kpi_uid: string; kpi_name: string; kpi_code: string; direction?: string };
  initialBands: DeductionBandInput[];
  onSaveBands: (b: DeductionBandInput[]) => Promise<void>;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<DeductionBandInput[]>(initialBands);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialBands);

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-medium text-sm text-slate-800 dark:text-slate-100">{kpi.kpi_name}</div>
          <div className="text-xs text-slate-500 font-mono">
            {kpi.kpi_code} · {kpi.direction === 'lower_is_better' ? 'lower is better' : 'higher is better'}
          </div>
        </div>
        <button onClick={onRemove} className="p-1 hover:bg-rose-50 rounded text-rose-400">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <DeductionBands bands={draft} onChange={setDraft} />

      {dirty && (
        <div className="flex justify-end mt-2">
          <button disabled={saving} onClick={async () => {
            setSaving(true);
            try { await onSaveBands(draft); }
            finally { setSaving(false); }
          }} className="btn-primary btn-sm">
            {saving ? 'Saving…' : 'Save bands'}
          </button>
        </div>
      )}
    </div>
  );
}

function toBand(d: any): DeductionBandInput {
  return {
    metric_type: d.metric_type,
    min_value: d.min_value,
    max_value: d.max_value,
    min_inclusive: d.min_inclusive,
    max_inclusive: d.max_inclusive,
    deduction_percent: d.deduction_percent,
    name: d.name,
  };
}
