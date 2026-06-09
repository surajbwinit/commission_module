'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import toast from 'react-hot-toast';

import PlanBasicsCard from '@/components/plan-builder/PlanBasicsCard';
import ScopeCard from '@/components/plan-builder/ScopeCard';
import PayoutStructureCard from '@/components/plan-builder/PayoutStructureCard';
import MonitorMetricsCard from '@/components/plan-builder/MonitorMetricsCard';
import RulesCard from '@/components/plan-builder/RulesCard';
// import AdjustmentsCard from '@/components/plan-builder/AdjustmentsCard'; // hidden — see Rules tab
import {
  ArrowLeft, Settings2, Target, Calculator, Filter,
} from 'lucide-react';
import PageHero from '@/components/layout/PageHero';
import { Tabs } from '@/components/ui/Tabs';
import { cn } from '@/lib/utils';

// Status pill matching the plans-list page — one colour per status:
// active=green, draft=amber, expired=grey, archived=red.
const STATUS_STYLES: Record<string, { pill: string; dot: string; label: string }> = {
  active:   { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
              dot:  'bg-emerald-500', label: 'Active' },
  draft:    { pill: 'bg-amber-50   text-amber-800  ring-amber-200  dark:bg-amber-500/15  dark:text-amber-300  dark:ring-amber-500/30',
              dot:  'bg-amber-500',  label: 'Draft' },
  expired:  { pill: 'bg-slate-100  text-slate-700  ring-slate-200  dark:bg-slate-700/40  dark:text-slate-300  dark:ring-slate-600',
              dot:  'bg-slate-400',  label: 'Expired' },
  archived: { pill: 'bg-rose-50    text-rose-700   ring-rose-200   dark:bg-rose-500/15   dark:text-rose-300   dark:ring-rose-500/30',
              dot:  'bg-rose-500',   label: 'Archived' },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset',
      s.pill,
    )}>
      <span className={cn('inline-block w-1.5 h-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}
import Link from 'next/link';

type TabId = 'plan' | 'calculation' | 'kpis' | 'rules';

const TABS: { value: TabId; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { value: 'plan',        label: 'Plan',            icon: Settings2,  description: 'Basics, scope and KPI targets.' },
  { value: 'calculation', label: "KPI's & Weights", icon: Calculator, description: 'Payout structure: target KPIs, slabs and weights.' },
  { value: 'kpis',        label: 'Deductions',      icon: Target,     description: 'Monitor metrics and their deduction bands.' },
  { value: 'rules',       label: 'Rules',           icon: Filter,     description: 'Mapping rules + advanced adjustments — bonuses, penalties, caps, splits, fixed bonuses, monthly overrides.' },
];

export default function PlanBuilderPage() {
  const params = useParams<{ id: string }>();
  // Route slot is named [id] for URL stability; the value passed is the plan uid.
  const uid = params?.id;
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>(() => {
    if (typeof window === 'undefined') return 'plan';
    const hash = window.location.hash.replace('#', '');
    return (TABS.find((t) => t.value === hash)?.value ?? 'plan') as TabId;
  });

  const load = useCallback(() => {
    if (!uid) return;
    api.get<unknown, any>(`/plans/${uid}`)
      .then(setPlan)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${tab}`);
    }
  }, [tab]);

  if (loading) return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-2">
        <div className="h-4 w-24 bg-muted rounded animate-pulse" />
        <div className="h-8 w-72 bg-muted rounded animate-pulse" />
        <div className="h-3 w-96 bg-muted rounded animate-pulse" />
      </div>
      <div className="h-10 w-full max-w-md bg-muted rounded animate-pulse" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-40 w-full max-w-4xl bg-muted rounded-xl animate-pulse" />)}
      </div>
    </div>
  );
  if (!plan) return <div className="text-sm text-muted-foreground">Plan not found.</div>;

  const activeTab = TABS.find((t) => t.value === tab)!;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHero
        title={plan.name || 'Plan'}
        subtitle={plan.description}
        accessory={
          <div className="flex items-center gap-2">
            <Link href="/plans" className="btn-ghost btn-sm"><ArrowLeft className="h-3.5 w-3.5" /> All plans</Link>
            {plan.status && <StatusPill status={plan.status} />}
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        <div className="min-w-0 max-w-4xl">
          {/* Tab bar — scrolls with the page so there's no sticky-bleed when
              cards above scroll under it. */}
          <div className="mb-5 pb-3 border-b border-slate-200 dark:border-slate-700">
            <Tabs<TabId>
              value={tab}
              onChange={setTab}
              options={TABS.map((t) => ({ value: t.value, label: t.label, icon: t.icon }))}
            />
            <p className="mt-2 text-xs text-muted-foreground">{activeTab.description}</p>
          </div>

          {/* Tab content */}
          <div className="space-y-4">
            {tab === 'plan' && (
              <>
                <PlanBasicsCard plan={plan} onChange={load} />
                <ScopeCard plan={plan} onChange={load} />
              </>
            )}
            {tab === 'kpis' && (
              <MonitorMetricsCard plan={plan} onChange={load} />
            )}
            {tab === 'calculation' && (
              <PayoutStructureCard plan={plan} onChange={load} />
            )}
            {tab === 'rules' && (
              <>
                <RulesCard plan={plan} onChange={load} />
                {/* AdjustmentsCard hidden for now — bonuses/penalties/caps/splits/fixed
                    bonuses/monthly target overrides aren't in scope for the current plans. */}
                {/* <AdjustmentsCard plan={plan} onChange={load} /> */}
              </>
            )}
          </div>
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-4 space-y-3">
            <div className="rounded-xl border bg-card p-4">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-2">Live preview</div>
              <div className="text-sm text-muted-foreground">
                Coming next: real-time payout calculation as you edit, against a sample employee.
              </div>
            </div>
            <div className="rounded-xl border bg-muted/40 p-3 text-xs text-foreground">
              <strong className="font-semibold">Tip:</strong> hover any <span className="inline-block px-1 border bg-background rounded font-mono text-[10px]">?</span> icon for a plain-English explanation.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
