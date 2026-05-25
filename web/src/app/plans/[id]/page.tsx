'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import toast from 'react-hot-toast';

import PlanBasicsCard from '@/components/plan-builder/PlanBasicsCard';
import ScopeCard from '@/components/plan-builder/ScopeCard';
import PayoutStructureCard from '@/components/plan-builder/PayoutStructureCard';
import MonitorMetricsCard from '@/components/plan-builder/MonitorMetricsCard';
import EligibilityCard from '@/components/plan-builder/EligibilityCard';
import RulesCard from '@/components/plan-builder/RulesCard';
import AdjustmentsCard from '@/components/plan-builder/AdjustmentsCard';
import {
  ArrowLeft, Settings2, Target, Calculator, Filter,
} from 'lucide-react';
import PageHero from '@/components/layout/PageHero';
import { Badge } from '@/components/ui/Pill';
import { Tabs } from '@/components/ui/Tabs';
import Link from 'next/link';

type TabId = 'plan' | 'kpis' | 'calculation' | 'rules';

const TABS: { value: TabId; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { value: 'plan',        label: 'Plan',         icon: Settings2,  description: 'Basics, scope and eligibility.' },
  { value: 'kpis',        label: 'KPIs',         icon: Target,     description: 'Monitor metrics that affect deductions.' },
  { value: 'calculation', label: 'Calculation',  icon: Calculator, description: 'Payout structure: target KPIs, slabs and weights.' },
  { value: 'rules',       label: 'Rules',        icon: Filter,     description: 'Mapping rules + advanced adjustments — bonuses, penalties, caps, splits, fixed bonuses, monthly overrides.' },
];

export default function PlanBuilderPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>(() => {
    if (typeof window === 'undefined') return 'plan';
    const hash = window.location.hash.replace('#', '');
    return (TABS.find((t) => t.value === hash)?.value ?? 'plan') as TabId;
  });

  const load = useCallback(() => {
    if (!id) return;
    api.get<unknown, any>(`/plans/${id}`)
      .then(setPlan)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [id]);

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
        eyebrow="Plan builder"
        title={plan.name || 'Plan'}
        subtitle={plan.description || 'Configure scope, structure, eligibility and rules.'}
        accessory={
          <div className="flex items-center gap-2">
            <Link href="/plans" className="btn-ghost btn-sm"><ArrowLeft className="h-3.5 w-3.5" /> All plans</Link>
            {plan.status && <Badge tone={plan.status === 'active' ? 'success' : plan.status === 'draft' ? 'neutral' : 'warning'}>{plan.status}</Badge>}
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        <div className="min-w-0 max-w-4xl">
          {/* Sticky tab bar */}
          <div className="sticky top-0 z-20 -mt-2 mb-5 bg-background/80 backdrop-blur-sm">
            <Tabs<TabId>
              value={tab}
              onChange={setTab}
              options={TABS.map((t) => ({ value: t.value, label: t.label, icon: t.icon }))}
            />
            <p className="mt-3 text-xs text-muted-foreground">{activeTab.description}</p>
          </div>

          {/* Tab content */}
          <div className="space-y-4">
            {tab === 'plan' && (
              <>
                <PlanBasicsCard plan={plan} onChange={load} />
                <ScopeCard plan={plan} onChange={load} />
                <EligibilityCard plan={plan} onChange={load} />
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
                <AdjustmentsCard plan={plan} onChange={load} />
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
