'use client';
import { useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';
import { formatDate } from '@/lib/utils';

interface Plan {
  id: string;
  name: string;
  description?: string;
  status: string;
  plan_type: string;
  effective_from: string;
  effective_to: string;
  base_payout: number;
  currency: string;
}

export default function PlanBasicsCard({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [draft, setDraft] = useState({
    name: plan.name,
    description: plan.description ?? '',
    plan_type: plan.plan_type,
    effective_from: (plan.effective_from || '').slice(0, 10),
    effective_to: (plan.effective_to || '').slice(0, 10),
    base_payout: plan.base_payout,
    status: plan.status,
  });
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify({
    name: plan.name,
    description: plan.description ?? '',
    plan_type: plan.plan_type,
    effective_from: (plan.effective_from || '').slice(0, 10),
    effective_to: (plan.effective_to || '').slice(0, 10),
    base_payout: plan.base_payout,
    status: plan.status,
  });

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}`, draft);
      toast.success('Basics saved');
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="1. Plan basics" subtitle="Name, period, base payout, and whether it's draft or active.">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Plan name" full>
          <input
            className="input w-full"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label="Status">
          <select className="input w-full" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Plan type">
          <select className="input w-full" value={draft.plan_type} onChange={(e) => setDraft({ ...draft, plan_type: e.target.value })}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
        </Field>
        <Field label="Effective from">
          <input type="date" className="input w-full" value={draft.effective_from} onChange={(e) => setDraft({ ...draft, effective_from: e.target.value })} />
        </Field>
        <Field label="Effective to">
          <input type="date" className="input w-full" value={draft.effective_to} onChange={(e) => setDraft({ ...draft, effective_to: e.target.value })} />
        </Field>
        <Field label={<span>Base payout <Tip k="gross_payout" /></span>}>
          <input type="number" className="input w-full" value={draft.base_payout}
            onChange={(e) => setDraft({ ...draft, base_payout: parseFloat(e.target.value) || 0 })} />
        </Field>
        <Field label="Description" full>
          <textarea className="input w-full" rows={2} value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </Field>
      </div>
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => setDraft({
            name: plan.name, description: plan.description ?? '',
            plan_type: plan.plan_type,
            effective_from: (plan.effective_from || '').slice(0, 10),
            effective_to: (plan.effective_to || '').slice(0, 10),
            base_payout: plan.base_payout, status: plan.status,
          })} className="text-sm px-3 py-1.5 rounded-md text-fg-muted hover:bg-sunken">Discard</button>
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </Card>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function Field({ label, children, full }: { label: React.ReactNode; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={'text-sm ' + (full ? 'md:col-span-3' : '')}>
      <span className="block text-xs uppercase text-fg-muted mb-1 flex items-center gap-1">{label}</span>
      {children}
    </label>
  );
}
