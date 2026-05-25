'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';
import DeductionBands, { type DeductionBandInput } from './DeductionBands';

interface Plan {
  id: string;
  kpis?: { id: string; kpi_id: string; kpi_name: string; kpi_code: string; weight: number; target_value: number; direction?: string; unit?: string }[];
  kpi_deduction_rules?: {
    id: string; kpi_id: string; kpi_name?: string; kpi_code?: string; role_id: string | null;
    metric_type: 'shortfall_percent' | 'achievement_percent' | 'actual_value';
    min_value: number | null; max_value: number | null;
    min_inclusive: number; max_inclusive: number;
    deduction_percent: number; priority: number; name?: string;
  }[];
}

interface KpiDef { id: string; name: string; code: string; category: string; direction: string; }

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
  const dedsFor = (kpiId: string) =>
    (plan.kpi_deduction_rules ?? []).filter((d) => d.kpi_id === kpiId);

  const savePlanKpis = async () => {
    const all = plan.kpis ?? [];
    await api.put(`/plans/${plan.id}/kpis`, {
      kpis: all.map((k) => ({
        kpiId: k.kpi_id, weight: k.weight, targetValue: k.target_value, slabSetId: null,
      })),
    });
  };

  const saveDeductions = async (allRules: { kpi_id: string; bands: DeductionBandInput[] }[]) => {
    const flat: any[] = [];
    for (const r of allRules) {
      for (const b of r.bands) {
        flat.push({
          kpiId: r.kpi_id,
          name: b.name ?? '',
          metricType: b.metric_type ?? 'actual_value',
          minValue: b.min_value, maxValue: b.max_value,
          minInclusive: b.min_inclusive ?? 1, maxInclusive: b.max_inclusive ?? 1,
          deductionPercent: b.deduction_percent,
        });
      }
    }
    await api.put(`/plans/${plan.id}/kpi-deductions`, { rules: flat });
  };

  const addMonitor = async (kpiId: string) => {
    setPicker(false);
    const next = [...(plan.kpis ?? []), {
      id: '', kpi_id: kpiId, kpi_name: library.find((l) => l.id === kpiId)?.name ?? '',
      kpi_code: library.find((l) => l.id === kpiId)?.code ?? '',
      weight: 0, target_value: 100,
    }];
    try {
      await api.put(`/plans/${plan.id}/kpis`, {
        kpis: next.map((k) => ({
          kpiId: k.kpi_id, weight: k.weight, targetValue: k.target_value, slabSetId: null,
        })),
      });
      toast.success('Monitor metric added');
      onChange();
    } catch (e: any) { toast.error(e.message); }
  };

  const removeMonitor = async (kpiId: string) => {
    const remaining = (plan.kpis ?? []).filter((k) => k.kpi_id !== kpiId);
    try {
      await api.put(`/plans/${plan.id}/kpis`, {
        kpis: remaining.map((k) => ({
          kpiId: k.kpi_id, weight: k.weight, targetValue: k.target_value, slabSetId: null,
        })),
      });
      // also strip deduction rules
      const remainingByKpi = monitorKpis.filter((k) => k.kpi_id !== kpiId).map((k) => ({
        kpi_id: k.kpi_id,
        bands: dedsFor(k.kpi_id).map(toBand),
      }));
      await saveDeductions(remainingByKpi);
      toast.success('Monitor metric removed');
      onChange();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <section className="card p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold">4. Targets they must maintain</h2>
        <p className="text-xs text-fg-muted mt-0.5">
          Metrics that don't drive payout, but failing them reduces the final amount.
          <Tip k="kpi_deduction" className="ml-1" />
        </p>
      </header>

      <div className="space-y-3">
        {monitorKpis.map((k) => (
          <MonitorKpiCard
            key={k.kpi_id}
            kpi={k}
            initialBands={dedsFor(k.kpi_id).map(toBand)}
            onSaveBands={async (newBands) => {
              const byKpi = monitorKpis.map((mk) => ({
                kpi_id: mk.kpi_id,
                bands: mk.kpi_id === k.kpi_id ? newBands : dedsFor(mk.kpi_id).map(toBand),
              }));
              await saveDeductions(byKpi);
              onChange();
            }}
            onRemove={() => removeMonitor(k.kpi_id)}
          />
        ))}

        {monitorKpis.length === 0 && (
          <div className="text-sm text-fg-muted italic">No monitor metrics yet.</div>
        )}
      </div>

      <div className="mt-4 relative">
        <button onClick={() => setPicker((v) => !v)}
          className="inline-flex items-center gap-1 text-sm text-primary hover:bg-primary/10 px-3 py-1.5 border border-dashed border-primary/40 rounded-md transition-colors">
          <Plus className="w-4 h-4" /> Add monitor metric
        </button>
        {picker && (
          <div className="absolute top-full mt-1 z-10 w-96 card shadow-lg max-h-72 overflow-y-auto">
            {library
              .filter((l) => !(plan.kpis ?? []).some((k) => k.kpi_id === l.id))
              .map((l) => (
                <button key={l.id} onClick={() => addMonitor(l.id)}
                  className="w-full text-left px-3 py-2 hover:bg-sunken border-b border-line/60 last:border-b-0">
                  <div className="text-sm font-medium">{l.name}</div>
                  <div className="text-xs text-fg-muted">{l.category} · {l.code}</div>
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
  kpi: { kpi_id: string; kpi_name: string; kpi_code: string; direction?: string };
  initialBands: DeductionBandInput[];
  onSaveBands: (b: DeductionBandInput[]) => Promise<void>;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<DeductionBandInput[]>(initialBands);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialBands);

  return (
    <div className="border border-line rounded-lg p-4 bg-sunken/40">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-medium text-sm">{kpi.kpi_name}</div>
          <div className="text-xs text-fg-muted font-mono">
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
