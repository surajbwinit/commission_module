'use client';
import { Plus, Trash2 } from 'lucide-react';
import Tip from '@/components/Tip';
import { cn } from '@/lib/utils';

export interface DeductionBandInput {
  metric_type?: 'shortfall_percent' | 'achievement_percent' | 'actual_value';
  min_value: number | null;
  max_value: number | null;
  min_inclusive?: number;
  max_inclusive?: number;
  deduction_percent: number;
  name?: string;
}

interface Props {
  bands: DeductionBandInput[];
  onChange: (bands: DeductionBandInput[]) => void;
}

/**
 * Visual editor for one KPI's deduction bands. Each band is shown as a
 * red-tinted bar with the deduction % on the right.
 */
export default function DeductionBands({ bands, onChange }: Props) {
  const update = (idx: number, patch: Partial<DeductionBandInput>) => {
    onChange(bands.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };
  const remove = (idx: number) => onChange(bands.filter((_, i) => i !== idx));
  const add = () => {
    const lastMax = bands.length ? (bands[bands.length - 1].max_value ?? 0) : 0;
    onChange([
      ...bands,
      { min_value: lastMax, max_value: lastMax + 5, deduction_percent: 10, metric_type: 'actual_value' },
    ]);
  };

  // Bars scaled 0..max → find dynamically
  const maxValue = Math.max(
    20,
    ...bands.flatMap((b) => [b.min_value ?? 0, b.max_value ?? 0])
  );
  const pct = (v: number) => Math.min(100, (v / maxValue) * 100);

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-fg-muted flex items-center gap-1">
        Deduction bands <Tip k="kpi_deduction" />
        <span className="ml-auto text-[10px] text-fg-subtle uppercase tracking-wider">value →</span>
      </div>

      <div className="space-y-1.5">
        {bands.map((b, idx) => {
          const left = pct(b.min_value ?? 0);
          const right = pct(b.max_value ?? maxValue);
          const intensity = b.deduction_percent >= 20 ? 'bg-rose-300' : 'bg-rose-200';
          return (
            <div key={idx} className="flex items-center gap-2">
              <div className="flex items-center gap-1 w-36 text-xs">
                <input
                  type="number"
                  step="any"
                  className="input w-14 text-xs px-1.5 py-1"
                  value={b.min_value ?? ''}
                  onChange={(e) => update(idx, { min_value: e.target.value === '' ? null : parseFloat(e.target.value) })}
                />
                <span className="text-fg-subtle">→</span>
                <input
                  type="number"
                  step="any"
                  className="input w-14 text-xs px-1.5 py-1"
                  placeholder="·~"
                  value={b.max_value ?? ''}
                  onChange={(e) => update(idx, { max_value: e.target.value === '' ? null : parseFloat(e.target.value) })}
                />
              </div>

              <div className="flex-1 relative h-6">
                <div className="absolute inset-0 bg-sunken rounded" />
                <div
                  className={cn('absolute inset-y-0 rounded', intensity)}
                  style={{ left: `${left}%`, right: `${100 - right}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-xs text-rose-900 font-medium">
                  −{b.deduction_percent}%
                </div>
              </div>

              <div className="flex items-center gap-1 w-28">
                <input
                  type="number"
                  className="input w-16 text-xs px-1.5 py-1"
                  value={b.deduction_percent}
                  onChange={(e) => update(idx, { deduction_percent: parseFloat(e.target.value) || 0 })}
                />
                <span className="text-xs text-fg-muted">% off</span>
              </div>

              <select
                className="input text-xs w-36 px-1.5 py-1"
                value={b.metric_type ?? 'actual_value'}
                onChange={(e) => update(idx, { metric_type: e.target.value as DeductionBandInput['metric_type'] })}
              >
                <option value="actual_value">Actual value</option>
                <option value="achievement_percent">Achievement %</option>
                <option value="shortfall_percent">Shortfall %</option>
              </select>

              <button onClick={() => remove(idx)} className="p-1 hover:bg-rose-50 rounded text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <button onClick={add} className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 px-2 py-1 transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add band
      </button>
    </div>
  );
}
