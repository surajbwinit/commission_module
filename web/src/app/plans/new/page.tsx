'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Copy, Sparkles, ArrowLeft,
  Settings2, Target, Calculator, Filter, Lock,
} from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import PageHero from '@/components/layout/PageHero';
import { Badge } from '@/components/ui/Pill';
import { Tabs } from '@/components/ui/Tabs';
import { formatCurrency } from '@/lib/utils';

type TabId = 'plan' | 'kpis' | 'calculation' | 'rules';

const TABS: { value: TabId; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { value: 'plan',        label: 'Plan',         icon: Settings2,  description: 'Basics, scope and eligibility.' },
  { value: 'kpis',        label: 'KPIs',         icon: Target,     description: 'Monitor metrics that affect deductions.' },
  { value: 'calculation', label: 'Calculation',  icon: Calculator, description: 'Payout structure: target KPIs, slabs and weights.' },
  { value: 'rules',       label: 'Rules',        icon: Filter,     description: 'Mapping rules and adjustments (multipliers / penalties).' },
];

interface PlanLite {
  id: string; name: string; description?: string;
  status: string; plan_type: string;
  effective_from: string; effective_to: string;
  base_payout: number; currency?: string;
}

export default function NewPlanPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    description: '',
    plan_type: 'monthly',
    effective_from: '',
    effective_to: '',
    base_payout: 0,
  });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabId>('plan');
  const [existingPlans, setExistingPlans] = useState<PlanLite[]>([]);

  useEffect(() => {
    api.get<unknown, PlanLite[]>('/plans').then(setExistingPlans).catch(() => {});
  }, []);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.name || !form.effective_from || !form.effective_to) {
      toast.error('Name and effective dates are required');
      return;
    }
    setSaving(true);
    try {
      const plan = await api.post<unknown, any>('/plans', form);
      toast.success('Plan created — now add KPIs, slabs and rules.');
      router.push(`/plans/${plan.id}`);
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const prefillFrom = (p: PlanLite) => {
    setForm({
      name: `${p.name} (copy)`,
      description: p.description ?? '',
      plan_type: p.plan_type ?? 'monthly',
      effective_from: '',
      effective_to: '',
      base_payout: p.base_payout ?? 0,
    });
    toast.success(`Prefilled from "${p.name}"`);
  };

  const activeTab = TABS.find((t) => t.value === tab)!;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHero
        eyebrow="Plan builder"
        title={form.name || 'New plan'}
        subtitle="Set the basics on this screen. KPIs, calculation and rules unlock once the plan is created."
        accessory={
          <div className="flex items-center gap-2">
            <Link href="/plans" className="btn-ghost btn-sm"><ArrowLeft className="h-3.5 w-3.5" /> All plans</Link>
            <Badge tone="neutral">draft</Badge>
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        <div className="min-w-0 max-w-4xl">
          {/* Sticky tab bar — mirrors the edit page */}
          <div className="sticky top-0 z-20 -mt-2 mb-5 bg-background/80 backdrop-blur-sm">
            <Tabs<TabId>
              value={tab}
              onChange={setTab}
              options={TABS.map((t) => ({ value: t.value, label: t.label, icon: t.icon }))}
            />
            <p className="mt-3 text-xs text-muted-foreground">{activeTab.description}</p>
          </div>

          {/* Tab content */}
          {tab === 'plan' ? (
            <form onSubmit={submit} className="space-y-4">
              <section className="card p-5">
                <header className="mb-4">
                  <h2 className="text-base font-semibold">1. Plan basics</h2>
                  <p className="text-xs text-fg-muted mt-0.5">
                    Required to create the plan. Everything else (KPIs, slabs, rules) is configured after.
                  </p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Field label="Plan name" full required>
                    <input
                      required
                      className="input w-full"
                      placeholder="e.g. Sales Plan 2026"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </Field>
                  <Field label="Plan type">
                    <select className="input w-full" value={form.plan_type} onChange={(e) => setForm({ ...form, plan_type: e.target.value })}>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </Field>
                  <Field label="Base payout">
                    <input
                      type="number"
                      className="input w-full"
                      placeholder="0"
                      value={form.base_payout || ''}
                      onChange={(e) => setForm({ ...form, base_payout: parseFloat(e.target.value) || 0 })}
                    />
                  </Field>
                  <Field label="Effective from" required>
                    <input
                      type="date"
                      required
                      className="input w-full"
                      value={form.effective_from}
                      onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
                    />
                  </Field>
                  <Field label="Effective to" required>
                    <input
                      type="date"
                      required
                      className="input w-full"
                      value={form.effective_to}
                      onChange={(e) => setForm({ ...form, effective_to: e.target.value })}
                    />
                  </Field>
                  <Field label="Description" full>
                    <textarea
                      className="input w-full"
                      rows={2}
                      placeholder="What does this plan do? Who is it for?"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-line/60">
                  <Link href="/plans" className="btn-ghost btn-sm">Cancel</Link>
                  <button type="submit" disabled={saving} className="btn-primary btn-sm">
                    {saving ? 'Creating…' : 'Create plan'}
                  </button>
                </div>
              </section>

              <p className="text-xs text-fg-subtle px-1">
                After creating, the Scope (roles / territories / employees) and Eligibility (qualifiers) cards
                will appear here, and the other tabs unlock.
              </p>
            </form>
          ) : (
            <LockedTab tabName={activeTab.label} />
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-3 hidden xl:block">
          <div className="rounded-xl border bg-card p-4">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-3">
              What you'll set, in order
            </div>
            <ol className="space-y-2.5 text-sm">
              <Step n={1} icon={Settings2}  active={tab === 'plan'}        label="Plan basics" sub="Name, dates, base payout" />
              <Step n={2} icon={Target}     active={false} dimmed          label="KPIs"        sub="Monitor metrics + deductions" />
              <Step n={3} icon={Calculator} active={false} dimmed          label="Calculation" sub="Payout KPIs, weights, slabs" />
              <Step n={4} icon={Filter}     active={false} dimmed          label="Rules"       sub="Mapping + advanced adjustments" />
            </ol>
          </div>

          {existingPlans.length > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Or duplicate existing
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                Use any plan as a starting point. We'll prefill the basics — you'll still need to set new dates.
              </p>
              <ul className="space-y-0.5 max-h-64 overflow-y-auto -mx-1">
                {existingPlans.slice(0, 12).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => prefillFrom(p)}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-accent transition-colors group"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <Sparkles className="h-3 w-3 text-muted-foreground group-hover:text-primary shrink-0" />
                        <span className="truncate">{p.name}</span>
                      </span>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {formatCurrency(p.base_payout, p.currency)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function LockedTab({ tabName }: { tabName: string }) {
  return (
    <section className="card p-10 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-muted text-muted-foreground flex items-center justify-center">
        <Lock className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-semibold">{tabName} unlocks after creating the plan</h3>
      <p className="text-xs text-fg-muted mt-1.5 max-w-md mx-auto">
        Go back to the <strong>Plan</strong> tab, fill in name + dates, and click <strong>Create plan</strong>.
        You'll land straight on the full editor where this tab becomes active.
      </p>
    </section>
  );
}

function Step({
  n, icon: Icon, label, sub, active, dimmed,
}: {
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
  active?: boolean;
  dimmed?: boolean;
}) {
  return (
    <li className={`flex items-start gap-2.5 ${dimmed ? 'opacity-55' : ''}`}>
      <span className={
        'inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-semibold tabular-nums shrink-0 mt-0.5 ' +
        (active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')
      }>{n}</span>
      <div className="flex-1">
        <div className={'font-medium flex items-center gap-1.5 ' + (active ? 'text-foreground' : 'text-foreground/80')}>
          <Icon className="h-3 w-3 text-muted-foreground" />{label}
          {dimmed && <Lock className="h-3 w-3 text-muted-foreground" />}
        </div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
    </li>
  );
}

function Field({ label, children, required, full }: {
  label: React.ReactNode; children: React.ReactNode; required?: boolean; full?: boolean;
}) {
  return (
    <label className={'text-sm ' + (full ? 'md:col-span-3' : '')}>
      <span className="block text-xs uppercase text-fg-muted mb-1 flex items-center gap-1">
        {label}
        {required && <span className="text-destructive normal-case">*</span>}
      </span>
      {children}
    </label>
  );
}
