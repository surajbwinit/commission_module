'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Calculator, ArrowRight, AlertCircle } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';
import SlabLadder, { type SlabTierInput } from './SlabLadder';

interface KpiDefRow {
  uid: string;
  name: string;
  code: string;
  category: string;
  unit: string;
  direction: string;
}

interface PlanKpiRow {
  uid: string;
  kpi_uid: string;
  kpi_name: string;
  kpi_code: string;
  weight: number;
  target_value: number;
  slab_set_uid: string | null;
  direction?: string;
  unit?: string;
}

interface SlabSetRow {
  uid: string;
  name: string;
  type: string;
  kpi_uid: string;
  role_uid: string | null;
  role_name?: string | null;
  tiers: SlabTierInput[];
}

interface Plan {
  uid: string;
  base_payout: number;
  currency_uid?: string;
  currency_code?: string;
  kpis?: PlanKpiRow[];
  slab_sets?: SlabSetRow[];
}

export default function PayoutStructureCard({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [library, setLibrary] = useState<KpiDefRow[]>([]);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    api.get<unknown, KpiDefRow[]>('/kpis').then(setLibrary).catch(() => setLibrary([]));
  }, []);

  const payoutKpis = (plan.kpis ?? []).filter((k) => k.weight > 0);

  const slabFor = (kpi_uid: string): SlabSetRow | undefined =>
    (plan.slab_sets ?? []).find((s) => s.kpi_uid === kpi_uid);

  const saveKpis = async (kpis: PlanKpiRow[]) => {
    const monitorKpis = (plan.kpis ?? []).filter((k) => k.weight === 0);
    const all = [...kpis, ...monitorKpis];
    await api.put(`/plans/${plan.uid}/kpis`, {
      kpis: all.map((k) => ({
        kpiUid: k.kpi_uid, weight: k.weight, targetValue: k.target_value,
        slabSetUid: k.slab_set_uid,
      })),
    });
  };

  const saveSlabs = async (sets: SlabSetRow[]) => {
    await api.put(`/plans/${plan.uid}/slabs`, {
      slabSets: sets.map((s) => ({
        name: s.name, type: s.type, kpiUid: s.kpi_uid, roleUid: s.role_uid,
        tiers: s.tiers.map((t) => ({
          minPercent: t.min_percent, maxPercent: t.max_percent, rate: t.rate,
          rateType: t.rate_type, minInclusive: !!t.min_inclusive, maxInclusive: !!t.max_inclusive,
        })),
      })),
    });
  };

  const addKpi = async (kpiUid: string) => {
    const lib = library.find((l) => l.uid === kpiUid);
    if (!lib) return;
    setPicker(false);
    // Default the new KPI's weight to the remaining headroom so we never
    // breach 100% just by clicking "add".
    const used = payoutKpis.reduce((s, k) => s + (Number(k.weight) || 0), 0);
    const remaining = Math.max(0, 100 - used);
    if (remaining === 0) {
      toast.error('Total weight is already 100%. Reduce an existing KPI first to add a new one.');
      return;
    }
    const next: PlanKpiRow = {
      uid: '', kpi_uid: kpiUid, kpi_name: lib.name, kpi_code: lib.code,
      weight: remaining, target_value: 100,
      slab_set_uid: null, direction: lib.direction, unit: lib.unit,
    };
    const newPayout = [...payoutKpis, next];
    try {
      await saveKpis(newPayout);
      toast.success(`Added ${lib.name} (weight ${remaining}%)`);
      onChange();
    } catch (e: any) { toast.error(e.message); }
  };

  const removeKpi = async (kpiUid: string) => {
    try {
      await saveKpis(payoutKpis.filter((k) => k.kpi_uid !== kpiUid));
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
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">3. How they earn</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pick the metrics that drive payout, set targets, weights, and the pay-rate ladder.
          </p>
        </div>
        <div className={'text-xs font-medium px-2.5 py-1 rounded-full ring-1 ring-inset ' + (
          totalWeight === 100   ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' :
          totalWeight === 0     ? 'bg-slate-100  text-slate-500   ring-slate-200'  :
          totalWeight > 100     ? 'bg-rose-50    text-rose-700    ring-rose-200'   :
                                  'bg-amber-50   text-amber-800   ring-amber-200'
        )}>
          Total weight: {totalWeight}%
          {totalWeight > 100 && <span className="ml-1">(over 100%)</span>}
        </div>
      </header>

      {payoutKpis.length > 0 ? (
        <>
          <div className="space-y-3">
            {payoutKpis.map((k) => (
              <PayoutKpiCard
                key={k.kpi_uid}
                plan={plan}
                planKpi={k}
                slab={slabFor(k.kpi_uid)}
                onSaveKpi={async (patch) => {
                  // Hard-cap: total weight across payout KPIs must never exceed 100%.
                  const newWeight   = patch.weight ?? k.weight;
                  const otherWeight = payoutKpis
                    .filter((x) => x.kpi_uid !== k.kpi_uid)
                    .reduce((s, x) => s + (Number(x.weight) || 0), 0);
                  const projected = otherWeight + Number(newWeight || 0);
                  if (projected > 100) {
                    toast.error(`Total weight would be ${projected}%. Maximum allowed is 100%.`);
                    throw new Error('weight-cap');
                  }
                  const updated = payoutKpis.map((x) => (x.kpi_uid === k.kpi_uid ? { ...x, ...patch } : x));
                  await saveKpis(updated);
                  onChange();
                }}
                onSaveSlab={async (newSlab) => {
                  const others = (plan.slab_sets ?? []).filter((s) => s.kpi_uid !== k.kpi_uid);
                  await saveSlabs([...others, newSlab]);
                  onChange();
                }}
                onRemove={() => removeKpi(k.kpi_uid)}
              />
            ))}
          </div>

          <div className="mt-4 relative">
            <button
              onClick={() => setPicker((v) => !v)}
              className="inline-flex items-center gap-1 text-sm text-primary-600 hover:bg-primary-50 px-3 py-1.5 border border-dashed border-primary-300 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" /> Add payout metric
            </button>
            {picker && (
              <div className="absolute top-full mt-1 z-10 w-96 card shadow-lg max-h-72 overflow-y-auto">
                {library
                  .filter((l) => !payoutKpis.some((k) => k.kpi_uid === l.uid))
                  .map((l) => (
                    <button
                      key={l.uid}
                      onClick={() => addKpi(l.uid)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 dark:hover:bg-slate-800 dark:border-slate-800"
                    >
                      <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{l.name}</div>
                      <div className="text-xs text-slate-500">{l.category} · {l.code}</div>
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
  addKpi: (uid: string) => Promise<void>;
}) {
  return (
    <div className="border border-dashed border-slate-300 rounded-lg py-8 px-6 text-center bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="w-12 h-12 mx-auto mb-3 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center dark:bg-slate-700">
        <Calculator className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-semibold mb-1 text-slate-800 dark:text-slate-100">No payout metrics on this plan yet</h3>
      <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
        Payout metrics are KPIs with a weight greater than 0 — together they decide how the plan pays.
      </p>

      {monitorCount > 0 && (
        <div className="mt-4 inline-flex items-start gap-2 text-left text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2 max-w-md dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            This plan has <strong>{monitorCount} monitor KPI{monitorCount === 1 ? '' : 's'}</strong> (weight = 0).
            Those live on the <strong>KPIs</strong> tab. Set their weight above 0 to make them pay out, or pick a new metric below.
          </span>
        </div>
      )}

      {libraryCount === 0 ? (
        <div className="mt-5">
          <p className="text-xs text-slate-500 mb-2">No KPIs exist in your library yet.</p>
          <Link href="/kpis" className="btn-primary btn-sm">
            Create KPIs in the library <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="mt-5 relative inline-block">
          <button onClick={() => setPicker(!picker)} className="btn-primary btn-sm">
            <Plus className="w-3.5 h-3.5" /> Add payout metric
          </button>
          {picker && (
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-10 w-96 card shadow-lg max-h-72 overflow-y-auto text-left">
              {library.map((l) => (
                <button
                  key={l.uid}
                  onClick={() => addKpi(l.uid)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 dark:hover:bg-slate-800 dark:border-slate-800"
                >
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{l.name}</div>
                  <div className="text-xs text-slate-500">{l.category} · {l.code}</div>
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
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-medium text-sm text-slate-800 dark:text-slate-100">{planKpi.kpi_name}</div>
          <div className="text-xs text-slate-500 font-mono">{planKpi.kpi_code}</div>
        </div>
        <button onClick={onRemove} className="p-1 hover:bg-rose-50 rounded text-rose-400">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Target intentionally not editable here — it's sourced from ETL
            transactions (transaction_type='target') and the formula already
            divides by SUM(target). Plan-level target_value stays at 100. */}
        <label className="text-sm">
          <span className="block text-xs uppercase text-slate-500 mb-1 flex items-center gap-1">Weight % <Tip k="weight" /></span>
          <input type="number" className="input w-full text-sm" value={draftWeight} onChange={(e) => setDraftWeight(parseFloat(e.target.value) || 0)} />
        </label>
        <div className="text-sm">
          <span className="block text-xs uppercase text-slate-500 mb-1">Direction</span>
          <div className="px-2 py-1.5 bg-white border border-slate-200 rounded text-sm text-slate-500 dark:bg-slate-900 dark:border-slate-700">
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

      <SlabLadder tiers={draftTiers} onChange={setDraftTiers} currency={plan.currency_code} />

      {slabDirty && (
        <div className="flex justify-end mt-2">
          <button
            disabled={savingSlab}
            onClick={async () => {
              setSavingSlab(true);
              try {
                await onSaveSlab({
                  uid: slab?.uid ?? '',
                  name: `${planKpi.kpi_name} pay rate`,
                  type: 'step',
                  kpi_uid: planKpi.kpi_uid,
                  role_uid: slab?.role_uid ?? null,
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
