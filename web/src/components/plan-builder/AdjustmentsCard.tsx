'use client';
import AdvancedToggle from '@/components/AdvancedToggle';
import { Badge } from '@/components/ui/Pill';
import MultipliersEditor from './MultipliersEditor';
import PenaltiesEditor from './PenaltiesEditor';
import CapsEditor from './CapsEditor';
import SplitsEditor from './SplitsEditor';
import FixedIncentivesEditor from './FixedIncentivesEditor';
import MonthlyTargetsEditor from './MonthlyTargetsEditor';

interface Plan {
  id: string;
  currency?: string;
  kpis?: any[];
  multiplier_rules?: any[];
  penalty_rules?: any[];
  capping_rules?: any[];
  split_rules?: any[];
  fixed_incentives?: any[];
  monthly_targets?: any[];
}

const len = (xs?: any[]) => xs?.length ?? 0;

export default function AdjustmentsCard({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const counts = [
    { label: 'bonus',    n: len(plan.multiplier_rules) },
    { label: 'penalty',  n: len(plan.penalty_rules) },
    { label: 'cap',      n: len(plan.capping_rules) },
    { label: 'split',    n: len(plan.split_rules) },
    { label: 'fixed',    n: len(plan.fixed_incentives) },
    { label: 'override', n: len(plan.monthly_targets) },
  ].filter((c) => c.n > 0);
  const total = counts.reduce((s, c) => s + c.n, 0);

  const summary = total === 0
    ? <Badge tone="soft">none configured</Badge>
    : (
      <div className="flex items-center gap-1 flex-wrap justify-end">
        {counts.map((c) => (
          <Badge key={c.label} tone="primary">
            {c.n} {c.label}{c.n === 1 ? '' : 's'}
          </Badge>
        ))}
      </div>
    );

  return (
    <AdvancedToggle
      id={`plan-advanced-${plan.id}`}
      title="Advanced adjustments"
      subtitle="Bonuses, penalties, caps, splits, fixed bonuses, monthly target overrides. Most plans don't need these."
      summary={summary}
    >
      <div className="space-y-4 pt-4 animate-fade-in">
        <MultipliersEditor plan={plan} onChange={onChange} />
        <PenaltiesEditor plan={plan} onChange={onChange} />
        <CapsEditor plan={plan} onChange={onChange} />
        <SplitsEditor plan={plan} onChange={onChange} />
        <FixedIncentivesEditor plan={plan} onChange={onChange} />
        <MonthlyTargetsEditor plan={plan} onChange={onChange} />
      </div>
    </AdvancedToggle>
  );
}
