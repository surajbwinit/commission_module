'use client';
import { useEffect, useState } from 'react';
import {
  CheckCircle2, XCircle, Clock, Send, Shield, Lock, Loader2, MessageSquare, ChevronRight,
} from 'lucide-react';
import api from '@/lib/api';
import { formatCurrency, cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge, PillTabs } from '@/components/ui/Pill';
import PageHero from '@/components/layout/PageHero';

const STAGES = [
  { id: 'pending',           label: 'Pending',          shortLabel: 'Pending',    icon: Clock,        next: 'manager_approved',  terminal: false },
  { id: 'submitted',         label: 'Submitted',        shortLabel: 'Submitted',  icon: Send,         next: 'manager_approved',  terminal: false },
  { id: 'manager_approved',  label: 'Manager approved', shortLabel: 'Manager',    icon: Shield,       next: 'finance_approved',  terminal: false },
  { id: 'finance_approved',  label: 'Finance approved', shortLabel: 'Finance',    icon: CheckCircle2, next: 'hr_approved',       terminal: false },
  { id: 'hr_approved',       label: 'HR approved',      shortLabel: 'HR',         icon: Lock,         next: null,                terminal: true  },
] as const;

interface Payout {
  uid: string;
  emp_uid: string;
  employee_name: string;
  role_name: string;
  plan_uid: string;
  plan_name: string;
  period: string;
  gross_payout: number;
  kpi_deduction_amount: number;
  multiplier_amount: number;
  penalty_amount: number;
  net_payout: number;
  approval_status: string;
  eligibility_status: string;
  created_time: string;
}

type Stage = (typeof STAGES)[number]['id'];

export default function ApprovalsPage() {
  const [stage, setStage] = useState<Stage>('submitted');
  const [rows, setRows] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Payout | null>(null);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});

  const currentStage = STAGES.find((s) => s.id === stage)!;
  const isTerminal = currentStage.terminal;

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.get<unknown, Payout[]>(`/approvals?status=${stage}`);
      setRows(list);
      setSelected(new Set());
    } catch (e: any) {
      toast.error(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const loadCounts = async () => {
    const counts: Record<string, number> = {};
    await Promise.all(STAGES.map(async (s) => {
      try {
        const list = await api.get<unknown, Payout[]>(`/approvals?status=${s.id}`);
        counts[s.id] = list.length;
      } catch { counts[s.id] = 0; }
    }));
    setStageCounts(counts);
  };

  useEffect(() => { load(); }, [stage]);
  useEffect(() => { loadCounts(); }, []);

  const action = async (p: Payout, act: string, comments?: string) => {
    setActing(p.uid);
    try {
      await api.post(`/approvals/${p.uid}/action`, { action: act, actedBy: 'admin', comments });
      toast.success(act === 'rejected' ? 'Rejected' : 'Approved');
      load(); loadCounts();
    } catch (e: any) { toast.error(e.message); }
    finally { setActing(null); }
  };

  const bulkAdvance = async () => {
    const nextStage = currentStage.next;
    if (!nextStage) return;
    if (selected.size === 0) { toast.error('No rows selected'); return; }
    if (!confirm(`Advance ${selected.size} payout(s) to "${nextStage}"?`)) return;
    let ok = 0, fail = 0;
    for (const id of Array.from(selected)) {
      try {
        await api.post(`/approvals/${id}/action`, { action: nextStage, actedBy: 'admin', comments: 'Bulk action' });
        ok++;
      } catch { fail++; }
    }
    toast.success(`${ok} approved${fail > 0 ? `, ${fail} failed` : ''}`);
    load(); loadCounts();
  };

  const toggleAll = () => setSelected(selected.size === rows.length ? new Set<string>() : new Set(rows.map((r) => r.uid)));
  const toggle = (uid: string) => {
    const next = new Set(selected); if (next.has(uid)) next.delete(uid); else next.add(uid); setSelected(next);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHero
        title="Approvals"
        meta={
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {STAGES.map((s, i) => (
              <span key={s.id} className="inline-flex items-center gap-1.5">
                <span className={cn(
                  'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold border',
                  s.id === stage
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-muted text-muted-foreground border-border'
                )}>{i + 1}</span>
                <span className={cn(s.id === stage ? 'text-foreground font-medium' : 'text-muted-foreground')}>{s.shortLabel}</span>
                {i < STAGES.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground/60" />}
              </span>
            ))}
          </div>
        }
      />

      <PillTabs
        value={stage}
        onChange={setStage}
        options={STAGES.map((s) => ({ value: s.id, label: s.label, count: stageCounts[s.id] }))}
      />

      {rows.length > 0 && !isTerminal && (
        <div className="card flex items-center justify-between px-4 py-2.5">
          <label className="flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
            <input type="checkbox"
              checked={selected.size === rows.length && rows.length > 0}
              onChange={toggleAll}
              className="rounded border-slate-300" />
            <span>{selected.size > 0 ? `${selected.size} selected` : 'Select all'}</span>
          </label>
          {selected.size > 0 && currentStage.next && (
            <button onClick={bulkAdvance} className="btn-primary btn-sm">
              <Send className="w-3.5 h-3.5" /> Bulk advance to {labelOf(currentStage.next)}
            </button>
          )}
        </div>
      )}

      {isTerminal && rows.length > 0 && (
        <div className="card flex items-center gap-2.5 px-4 py-3 bg-emerald-50/40 dark:bg-emerald-500/5 border-emerald-200/60 dark:border-emerald-500/20">
          <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <div className="text-sm">
            <span className="font-medium text-emerald-700 dark:text-emerald-300">Final stage.</span>{' '}
            <span className="text-fg-muted">These payouts have completed the approval chain — no further action needed.</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No payouts at this stage" description="Run a calculation or check another stage." />
      ) : (
        <section className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-2xs uppercase tracking-wider text-fg-subtle bg-sunken/60 sticky top-0 backdrop-blur z-10">
              <tr>
                {!isTerminal && <th className="pl-5 pr-2 py-3 w-8"></th>}
                <th className={cn('text-left px-2 py-3', isTerminal && 'pl-5')}>Employee</th>
                <th className="text-left px-2 py-3">Plan</th>
                <th className="text-left px-2 py-3">Period</th>
                <th className="text-right px-2 py-3">Gross</th>
                <th className="text-right px-2 py-3">Deduct</th>
                <th className="text-right px-2 py-3">Net</th>
                <th className="text-left px-2 py-3">Eligibility</th>
                <th className="text-right pl-2 pr-5 py-3">{isTerminal ? 'Status' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.uid} className={cn(
                  'border-t border-line/60 transition-colors',
                  selected.has(p.uid) ? 'bg-primary-50/40 dark:bg-primary-500/8' : 'hover:bg-sunken/40'
                )}>
                  {!isTerminal && (
                    <td className="pl-5 pr-2 py-3">
                      <input type="checkbox" checked={selected.has(p.uid)} onChange={() => toggle(p.uid)} className="rounded border-slate-300" />
                    </td>
                  )}
                  <td className={cn('px-2 py-3', isTerminal && 'pl-5')}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-300 via-primary-500 to-violet-600 text-white text-xs font-semibold flex items-center justify-center ring-2 ring-surface shadow-sm">
                        {p.employee_name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium text-fg">{p.employee_name}</div>
                        <div className="text-2xs text-fg-muted">{p.role_name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3 text-fg-muted">{p.plan_name}</td>
                  <td className="px-2 py-3 font-mono text-2xs text-fg-muted">{p.period}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-fg">{formatCurrency(p.gross_payout)}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-rose-600 dark:text-rose-400">−{formatCurrency(p.kpi_deduction_amount + p.penalty_amount)}</td>
                  <td className="px-2 py-3 text-right font-semibold tabular-nums text-fg">{formatCurrency(p.net_payout)}</td>
                  <td className="px-2 py-3">
                    <Badge tone={p.eligibility_status === 'eligible' ? 'success' : p.eligibility_status === 'reduced' ? 'warning' : 'danger'}>{p.eligibility_status}</Badge>
                  </td>
                  <td className="pl-2 pr-5 py-3">
                    {isTerminal ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-semibold ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
                          <Lock className="w-3 h-3" />
                          Approved
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          disabled={acting === p.uid}
                          onClick={() => {
                            const next = currentStage.next;
                            if (next) action(p, next);
                          }}
                          className="btn-sm btn bg-emerald-600 text-white hover:bg-emerald-700 shadow-card"
                        >
                          {acting === p.uid ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><CheckCircle2 className="w-3.5 h-3.5" /> Approve</>}
                        </button>
                        <button
                          disabled={acting === p.uid}
                          onClick={() => setRejectTarget(p)}
                          className="btn-sm btn bg-surface text-rose-600 border border-rose-200 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Modal
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="Reject payout"
        description={rejectTarget ? `${rejectTarget.employee_name} · ${rejectTarget.plan_name} · ${formatCurrency(rejectTarget.net_payout)}` : ''}
        size="md"
      >
        <RejectForm
          onCancel={() => setRejectTarget(null)}
          onSubmit={async (reason) => {
            if (rejectTarget) await action(rejectTarget, 'rejected', reason);
            setRejectTarget(null);
          }}
        />
      </Modal>
    </div>
  );
}

function PageHero_unused({ title, subtitle, accessory }: { title: string; subtitle?: string; accessory?: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card px-6 py-5 shadow-sm">
      <div className="pointer-events-none absolute inset-0 bg-premium-mesh opacity-50" />
      <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-primary-400/15 blur-3xl" />
      <div className="relative flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-gradient">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>}
        </div>
        {accessory && <div className="shrink-0">{accessory}</div>}
      </div>
    </div>
  );
}

function labelOf(id: string) {
  return STAGES.find((s) => s.id === id)?.shortLabel ?? id;
}

function RejectForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3">
      <div>
        <label className="label flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Reason</label>
        <textarea
          className="input"
          rows={4}
          placeholder="Why is this payout being rejected?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-secondary btn-sm">Cancel</button>
        <button disabled={!reason.trim()} onClick={() => onSubmit(reason)} className="btn-danger btn-sm">
          Reject payout
        </button>
      </div>
    </div>
  );
}
