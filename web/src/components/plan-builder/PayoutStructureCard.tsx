'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Calculator, ArrowRight, AlertCircle } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';
import SlabLadder, { type SlabTierInput } from './SlabLadder';

interface KpiDefRow {
  id: string;
  name: string;
  code: string;
  category: string;
  unit: string;
  direction: string;
}

interface PlanKpiRow {
  id: string;
  kpi_id: string;
  kpi_name: string;
  kpi_code: string;
  weight: number;
  target_value: number;
  slab_set_id: string | null;
  direction?: string;
  unit?: string;
}

interface SlabSetRow {
  id: string;
  name: string;
  type: string;
  kpi_id: string;
  role_id: string | null;
  role_name?: string | null;
  tiers: SlabTierInput[];
}

interface Plan {
  id: string;
  base_payout: number;
  currency?: string;
  kpis?: PlanKpiRow[];
  slab_sets?: SlabSetRow[];
}

/**
 * "How they earn" → combines the old KPIs + Slabs tabs.
 * Only shows KPIs with weight > 0 (the payout-driving ones).
 * Monitor KPIs (weight = 0) belong in MonitorMetricsCard.
 */
export default function PayoutStructureCard({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [library, setLibrary] = useState<KpiDefRow[]>([]);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    api.get<unknown, KpiDefRow[]>('/kpis').then(setLibrary).catch(() => setLibrary([]));
  }, []);

  const payoutKpis = (plan.kpis ?? []).filter((k) => k.weight > 0);

  const slabFor = (kpi_id: string): SlabSetRow | undefined =>
    (plan.slab_sets ?? []).find((s) => s.kpi_id === kpi_id);

  const saveKpis = async (kpis: PlanKpiRow[]) => {
    const monitorKpis = (plan.kpis ?? []).filter((k) => k.weight === 0);
    const all = [...kpis, ...monitorKpis];
    await api.put(`/plans/${plan.id}/kpis`, {
      kpis: all.map((k) => ({
        kpiId: k.kpi_id, weight: k.weight, targetValue: k.target_value,
        slabSetId: k.slab_set_id,
      })),
    });
  };

  const saveSlabs = async (sets: SlabSetRow[]) => {
    await api.put(`/plans/${plan.id}/slabs`, {
      slabSets: sets.map((s) => ({
        name: s.name, type: s.type, kpiId: s.kpi_id, roleId: s.role_id,
        tiers: s.tiers.map((t) => ({
          minPercent: t.min_percent, maxPercent: t.max_percent, rate: t.rate,
          rateType: t.rate_type, minInclusive: t.min_inclusive, maxInclusive: t.max_inclusive,
        })),
      })),
    });
  };

  const addKpi = async (kpiId: string) => {
    const lib = library.find((l) => l.id === kpiId);
    if (!lib) return;
    setPicker(false);
    const next: PlanKpiRow = {
      id: '', kpi_id: kpiId, kpi_name: lib.name, kpi_code: lib.code, weight: 100, target_value: 100,
      slab_set_id: null, direction: lib.direction, unit: lib.unit,
    };
    const newPayout = [...payoutKpis, next];
    try {
      await saveKpis(newPayout);
      toast.success(`Added ${lib.name}`);
      onChange();
    } catch (e: any) { toast.error(e.message); }
  };

  const removeKpi = async (kpiId: string) => {
    try {
      await saveKpis(payoutKpis.filter((k) => k.kpi_id !== kpiId));
      toast.success('Metric removed');
      onChange();
    } catch (e: any) { toast.error(e.message); }
  };

  const totalWeight = payoutKpis.reduce((s, k) => s + (Number(k.weight) || 0), 0);
  const monitorKpisCount = (plan.kpis ?? []).filter((k) => Number(k.weight) === 0).length;

  return (
    <section className="card p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">3. How they earn</h2>
          <p className="text-xs text-fg-muted mt-0.5">
            Pick the metrics that drive payout, set targets, weights, and the pay-rate ladder.
          </p>
        </div>
        <div className={'text-xs px-2 py-1 rounded ' + (totalWeight === 100
          ? 'bg-emerald-50 text-emerald-700'
          : totalWeight === 0 ? 'bg-sunken text-fg-muted' : 'bg-amber-50 text-amber-700')}>
          Total weight: {totalWeight}%
        </div>
      </header>

      {payoutKpis.length > 0 ? (
        <>
          <div className="space-y-3">
            {payoutKpis.map((k) => (
              <PayoutKpiCard
                key={k.kpi_id}
                plan={plan}
                planKpi={k}
                slab={slabFor(k.kpi_id)}
                onSaveKpi={async (patch) => {
                  const updated = payoutKpis.map((x) => (x.kpi_id === k.kpi_id ? { ...x, ...patch } : x));
                  await saveKpis(updated);
                  onChange();
                }}
                onSaveSlab={async (newSlab) => {
                  const others = (plan.slab_sets ?? []).filter((s) => s.kpi_id !== k.kpi_id);
                  await saveSlabs([...others, newSlab]);
                  onChange();
                }}
                onRemove={() => removeKpi(k.kpi_id)}
              />
            ))}
          </div>

          <div className="mt-4 relative">
            <button
              onClick={() => setPicker((v) => !v)}
              className="inline-flex items-center gap-1 text-sm text-primary hover:bg-primary/10 px-3 py-1.5 border border-dashed border-primary/40 rounded-md transition-colors"
            >
              <Plus className="w-4 h-4" /> Add payout metric
            </button>
            {picker && (
              <div className="absolute top-full mt-1 z-10 w-96 card shadow-lg max-h-72 overflow-y-auto">
                {library
                  .filter((l) => !payoutKpis.some((k) => k.kpi_id === l.id))
                  .map((l) => (
                    <button
                      key={l.id}
                      onClick={() => addKpi(l.id)}
                      className="w-full text-left px-3 py-2 hover:bg-sunken border-b border-line/60 last:border-b-0"
                    >
                      <div className="text-sm font-medium">{l.name}</div>
                      <div className="text-xs text-fg-muted">{l.category} · {l.code}</div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <EmptyPayoutState
          libraryCount={library.length}
          monitorCount={monitorKpisCount}
          picker={picker}
          setPicker={setPicker}
          library={library}
          addKpi={addKpi}
        />
      )}
    </section>
  );
}

function EmptyPayoutState({
  libraryCount, monitorCount, picker, setPicker, library, addKpi,
}: {
  libraryCount: number;
  monitorCount: number;
  picker: boolean;
  setPicker: (v: boolean) => void;
  library: KpiDefRow[];
  addKpi: (id: string) => Promise<void>;
}) {
  return (
    <div className="border border-dashed border-line rounded-lg py-8 px-6 text-center bg-sunken/30">
      <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-muted text-muted-foreground flex items-center justify-center">
        <Calculator className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-semibold mb-1">No payout metrics on this plan yet</h3>
      <p className="text-xs text-fg-muted max-w-md mx-auto leading-relaxed">
        Payout metrics are KPIs with a weight greater than 0 — together they decide how the plan pays.
      </p>

      {monitorCount > 0 && (
        <div className="mt-4 inline-flex items-start gap-2 text-left text-xs bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 rounded-md px-3 py-2 max-w-md">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            This plan has <strong>{monitorCount} monitor KPI{monitorCount === 1 ? '' : 's'}</strong> (weight = 0).
            Those live on the <strong>KPIs</strong> tab. Set their weight above 0 to make them pay out, or pick a new metric below.
          </span>
        </div>
      )}

      {libraryCount === 0 ? (
        <div className="mt-5">
          <p className="text-xs text-fg-muted mb-2">No KPIs exist in your library yet.</p>
          <Link href="/kpis" className="btn-primary btn-sm">
            Create KPIs in the library <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="mt-5 relative inline-block">
          <button
            onClick={() => setPicker(!picker)}
            className="btn-primary btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Add payout metric
          </button>
          {picker && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-10 w-96 card shadow-lg max-h-72 overflow-y-auto text-left">
              {library.map((l) => (
                <button
                  key={l.id}
                  onClick={() => addKpi(l.id)}
                  className="w-full text-left px-3 py-2 hover:bg-sunken border-b border-line/60 last:border-b-0"
                >
                  <div className="text-sm font-medium">{l.name}</div>
                  <div className="text-xs text-fg-muted">{l.category} · {l.code}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PayoutKpiCard({
  plan, planKpi, slab, onSaveKpi, onSaveSlab, onRemove,
}: {
  plan: Plan;
  planKpi: PlanKpiRow;
  slab?: SlabSetRow;
  onSaveKpi: (patch: Partial<PlanKpiRow>) => Promise<void>;
  onSaveSlab: (slab: SlabSetRow) => Promise<void>;
  onRemove: () => void;
}) {
  const [draftWeight, setDraftWeight] = useState(planKpi.weight);
  const [draftTarget, setDraftTarget] = useState(planKpi.target_value);
  const [draftTiers, setDraftTiers] = useState<SlabTierInput[]>(slab?.tiers ?? []);
  const [savingKpi, setSavingKpi] = useState(false);
  const [savingSlab, setSavingSlab] = useState(false);

  const kpiDirty = draftWeight !== planKpi.weight || draftTarget !== planKpi.target_value;
  const slabDirty = JSON.stringify(draftTiers) !== JSON.stringify(slab?.tiers ?? []);

  return (
    <div className="border border-line rounded-lg p-4 bg-sunken/40">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-medium text-sm text-fg">{planKpi.kpi_name}</div>
          <div className="text-xs text-fg-muted font-mono">{planKpi.kpi_code}</div>
        </div>
        <button onClick={onRemove} className="p-1 hover:bg-rose-50 rounded text-rose-400">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <label className="text-sm">
          <span className="block text-xs uppercase text-fg-muted mb-1 flex items-center gap-1">Target <Tip k="achievement_percent" /></span>
          <input type="number" className="input w-full text-sm" value={draftTarget} onChange={(e) => setDraftTarget(parseFloat(e.target.value) || 0)} />
        </label>
        <label className="text-sm">
          <span className="block text-xs uppercase text-fg-muted mb-1 flex items-center gap-1">Weight % <Tip k="weight" /></span>
          <input type="number" className="input w-full text-sm" value={draftWeight} onChange={(e) => setDraftWeight(parseFloat(e.target.value) || 0)} />
        </label>
        <div className="text-sm">
          <span className="block text-xs uppercase text-fg-muted mb-1">Direction</span>
          <div className="px-2 py-1.5 bg-surface border border-line rounded text-sm text-fg-muted">
            {planKpi.direction === 'lower_is_better' ? 'Lower is better' : 'Higher is better'}
          </div>
        </div>
      </div>

      {kpiDirty && (
        <div className="flex justify-end mb-3">
          <button
            disabled={savingKpi}
            onClick={async () => {
              setSavingKpi(true);
              try { await onSaveKpi({ weight: draftWeight, target_value: draftTarget }); }
              finally { setSavingKpi(false); }
            }}
            className="btn-primary btn-sm"
          >
            {savingKpi ? 'Saving…' : 'Save target / weight'}
          </button>
        </div>
      )}

      <SlabLadder tiers={draftTiers} onChange={setDraftTiers} currency={plan.currency ?? 'SAR'} />

      {slabDirty && (
        <div className="flex justify-end mt-2">
          <button
            disabled={savingSlab}
            onClick={async () => {
              setSavingSlab(true);
              try {
                await onSaveSlab({
                  id: slab?.id ?? '',
                  name: `${planKpi.kpi_name} pay rate`,
                  type: 'step',
                  kpi_id: planKpi.kpi_id,
                  role_id: slab?.role_id ?? null,
                  tiers: draftTiers,
                });
              } finally { setSavingSlab(false); }
            }}
            className="btn-primary btn-sm"
          >
            {savingSlab ? 'Saving…' : 'Save pay rate'}
          </button>
        </div>
      )}
    </div>
  );
}
