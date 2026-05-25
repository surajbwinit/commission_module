'use client';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import Tip from '@/components/Tip';

export interface SlabTierInput {
  min_percent: number;
  max_percent: number | null;
  rate: number;
  rate_type: 'percentage' | 'fixed' | 'per_unit' | 'per_achievement_point';
  min_inclusive?: number;
  max_inclusive?: number;
}

interface Props {
  tiers: SlabTierInput[];
  onChange: (tiers: SlabTierInput[]) => void;
  currency?: string;
}

const RATE_TYPE_LABEL: Record<SlabTierInput['rate_type'], string> = {
  percentage: '% of base',
  fixed: 'fixed SAR',
  per_unit: 'SAR per unit',
  per_achievement_point: 'SAR per 1% above min',
};

/**
 * Visual editor for slab tiers (pay rate). Each tier is one row showing
 * a colored bar from min_percent to max_percent and the rate on the right.
 */
export default function SlabLadder({ tiers, onChange, currency = 'SAR' }: Props) {
  const update = (idx: number, patch: Partial<SlabTierInput>) => {
    const next = tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    onChange(next);
  };
  const remove = (idx: number) => onChange(tiers.filter((_, i) => i !== idx));
  const add = () => {
    const lastMax = tiers.length ? (tiers[tiers.length - 1].max_percent ?? 100) : 0;
    onChange([
      ...tiers,
      { min_percent: lastMax, max_percent: lastMax + 10, rate: 0, rate_type: tiers[0]?.rate_type ?? 'per_achievement_point' },
    ]);
  };

  // Visual scale: 0 → 200% (covers most realistic ranges, capped)
  const SCALE_MAX = 200;
  const pct = (v: number) => Math.min(100, (v / SCALE_MAX) * 100);

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-fg-muted flex items-center gap-1">
        Pay rate <Tip k="slab" />
        <span className="ml-auto text-[10px] text-fg-subtle uppercase tracking-wider">% of target →</span>
      </div>

      {/* Scale ruler */}
      <div className="relative h-5 ml-32 mr-32 border-b border-line">
        {[0, 50, 100, 150, 200].map((m) => (
          <div key={m} className="absolute -bottom-1 -translate-x-1/2 text-[10px] text-fg-subtle" style={{ left: `${pct(m)}%` }}>
            {m}%
            <div className="h-1 w-px bg-neutral-200 mx-auto" />
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        {tiers.map((t, idx) => {
          const left = pct(t.min_percent);
          const right = pct(t.max_percent ?? SCALE_MAX);
          const open = t.max_percent == null;
          return (
            <div key={idx} className="flex items-center gap-2">
              {/* Min/max inputs */}
              <div className="flex items-center gap-1 w-32 text-xs">
                <input
                  type="number"
                  className="input w-12 text-xs px-1.5 py-1"
                  value={t.min_percent}
                  onChange={(e) => update(idx, { min_percent: parseFloat(e.target.value) || 0 })}
                />
                <span className="text-fg-subtle">→</span>
                <input
                  type="number"
                  className="input w-14 text-xs px-1.5 py-1"
                  placeholder="·~"
                  value={t.max_percent ?? ''}
                  onChange={(e) => update(idx, { max_percent: e.target.value === '' ? null : parseFloat(e.target.value) })}
                />
                <span className="text-fg-subtle">%</span>
              </div>

              {/* Visual bar */}
              <div className="flex-1 relative h-6">
                <div className="absolute inset-y-0 left-0 right-0 bg-sunken rounded" />
                <div
                  className={cn(
                    'absolute inset-y-0 rounded',
                    open ? 'bg-gradient-to-r from-emerald-200 to-emerald-100' : 'bg-emerald-200'
                  )}
                  style={{ left: `${left}%`, right: `${100 - right}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-xs text-emerald-900 font-medium">
                  Tier {idx + 1}
                </div>
              </div>

              {/* Rate + rate type */}
              <div className="flex items-center gap-1 w-32">
                <input
                  type="number"
                  className="input w-16 text-xs px-1.5 py-1"
                  value={t.rate}
                  onChange={(e) => update(idx, { rate: parseFloat(e.target.value) || 0 })}
                />
                <span className="text-xs text-fg-muted">{currency}</span>
              </div>

              <select
                className="input text-xs w-40 px-1.5 py-1"
                value={t.rate_type}
                onChange={(e) => update(idx, { rate_type: e.target.value as SlabTierInput['rate_type'] })}
              >
                {Object.entries(RATE_TYPE_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>

              <button onClick={() => remove(idx)} className="p-1 hover:bg-rose-50 rounded text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={add}
        className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 px-2 py-1 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> Add band
      </button>
    </div>
  );
}
