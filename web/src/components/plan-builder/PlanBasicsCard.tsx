'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import Tip from '@/components/Tip';
import { formatDate } from '@/lib/utils';

interface Plan {
  uid: string;
  name: string;
  description?: string;
  status: string;
  plan_type: string;
  effective_from: string;
  effective_to: string;
  base_payout: number;
  currency_uid?: string;
}

interface Currency {
  uid: string;
  code: string;
  name: string;
  symbol?: string;
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
    currency_uid: plan.currency_uid ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [currencies, setCurrencies] = useState<Currency[]>([]);

  useEffect(() => {
    api.get<unknown, Currency[]>('/currency').then(setCurrencies).catch(() => {});
  }, []);

  const baseline = {
    name: plan.name,
    description: plan.description ?? '',
    plan_type: plan.plan_type,
    effective_from: (plan.effective_from || '').slice(0, 10),
    effective_to: (plan.effective_to || '').slice(0, 10),
    base_payout: plan.base_payout,
    status: plan.status,
    currency_uid: plan.currency_uid ?? '',
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  const save = async () => {
    if (!draft.currency_uid) {
      toast.error('Currency is required');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/plans/${plan.uid}`, draft);
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
        <Field label={<span>Currency <span className="text-rose-500 normal-case">*</span></span>}>
          <select
            className="input w-full"
            value={draft.currency_uid}
            onChange={(e) => setDraft({ ...draft, currency_uid: e.target.value })}
          >
            <option value="">— select —</option>
            {currencies.map((c) => (
              <option key={c.uid} value={c.uid}>
                {c.code}{c.symbol ? ` (${c.symbol})` : ''} — {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" full>
          <textarea className="input w-full" rows={2} value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </Field>
      </div>
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => setDraft(baseline)} className="text-sm px-3 py-1.5 rounded-md text-fg-muted hover:bg-sunken">Discard</button>
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
