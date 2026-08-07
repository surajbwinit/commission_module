'use client';
import { useEffect, useState } from 'react';
import { Receipt, ShoppingCart, RotateCcw, Wallet, Calendar, Upload, CalendarCheck, MapPin, Target } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { useAppStore } from '@/lib/store';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { Badge, PillTabs } from '@/components/ui/Pill';
import PageHero from '@/components/layout/PageHero';
import { Pagination } from '@/components/ui/Pagination';

interface Tx {
  uid: string;
  transaction_type: string;
  emp_uid: string;
  customer_uid?: string; customer_name?: string; customer_code?: string;
  product_uid?: string;  product_name?: string;  product_code?: string;
  employee_name: string;
  quantity: number;
  amount: number;
  transaction_date: string;
  period: string;
}

interface TypeSummary {
  transaction_type: string;
  row_count: number;
  total_amount: number;
}

const TYPE_META: Record<string, { tone: 'success' | 'warning' | 'info' | 'soft' | 'primary'; icon: any }> = {
  sale:                   { tone: 'success', icon: ShoppingCart },
  return:                 { tone: 'warning', icon: RotateCcw },
  bad_return:             { tone: 'warning', icon: RotateCcw },
  collection:             { tone: 'info',    icon: Wallet },
  scheduled_visit:        { tone: 'soft',    icon: CalendarCheck },
  visit:                  { tone: 'primary', icon: MapPin },
  visit_outside_schedule: { tone: 'primary', icon: MapPin },
  target:                 { tone: 'info',    icon: Target },
};

// Tab -> transaction_type filter sent to the API (empty = no filter)
const TABS: { value: string; label: string; types: string[] }[] = [
  { value: 'all',        label: 'All',         types: [] },
  { value: 'sale',       label: 'Sales',       types: ['sale'] },
  { value: 'return',     label: 'Returns',     types: ['return'] },
  { value: 'bad_return', label: 'Bad returns', types: ['bad_return'] },
  { value: 'collection', label: 'Collections', types: ['collection'] },
  { value: 'visits',     label: 'Visits',      types: ['scheduled_visit', 'visit', 'visit_outside_schedule'] },
  { value: 'target',     label: 'Targets',     types: ['target'] },
];

export default function TransactionsPage() {
  const period = useAppStore((s) => s.selectedPeriod);
  const [rows, setRows] = useState<Tx[]>([]);
  const [summary, setSummary] = useState<TypeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  // Fallback when /transactions/summary is unavailable (older API): a full
  // page implies at least one more page exists.
  const [lastPageFull, setLastPageFull] = useState(false);

  const countOf = (types: string[]) =>
    summary.filter((s) => types.length === 0 || types.includes(s.transaction_type))
           .reduce((n, s) => n + Number(s.row_count), 0);
  const sumOf = (types: string[]) =>
    summary.filter((s) => types.includes(s.transaction_type))
           .reduce((n, s) => n + Number(s.total_amount), 0);

  const activeTab = TABS.find((t) => t.value === type) ?? TABS[0];
  // Exact total from the summary endpoint; without it, a moving lower bound
  // keeps the Next button usable.
  const knownTotal = summary.length > 0 ? countOf(activeTab.types) : null;
  const total = knownTotal ?? (page - 1) * pageSize + rows.length + (lastPageFull ? pageSize : 0);

  // True totals for the cards/tabs
  useEffect(() => {
    api.get<unknown, TypeSummary[]>(`/transactions/summary?period=${period}`)
      .then(setSummary)
      .catch(() => setSummary([]));
  }, [period]);

  // Reset to page 1 when the slice changes
  useEffect(() => { setPage(1); }, [period, type, pageSize]);

  // Server-side page fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const typeParam = activeTab.types.length ? `&type=${activeTab.types.join(',')}` : '';
    const offset = (page - 1) * pageSize;
    api.get<unknown, Tx[]>(`/transactions?period=${period}&limit=${pageSize}&offset=${offset}${typeParam}`)
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setLastPageFull(data.length === pageSize);
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, type, page, pageSize]);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHero
        title="Transactions"
        accessory={<Badge tone="soft"><Calendar className="w-3 h-3" /> {period}</Badge>}
        actions={
          <Link href="/transactions/upload" className="btn-outline btn-sm">
            <Upload className="w-3.5 h-3.5" /> Bulk upload
          </Link>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard tone="indigo"  label="Total rows" value={countOf([]).toLocaleString()} icon={Receipt} />
        <SummaryCard tone="emerald" label="Total sales" value={formatCurrency(sumOf(['sale']))} icon={ShoppingCart} />
        <SummaryCard tone="amber"   label="Total returns" value={formatCurrency(sumOf(['return', 'bad_return']))} icon={RotateCcw} />
        <SummaryCard tone="sky"     label="Total collected" value={formatCurrency(sumOf(['collection']))} icon={Wallet} />
      </div>

      <PillTabs
        value={type}
        onChange={setType}
        options={TABS.map((t) => ({ value: t.value, label: t.label, count: countOf(t.types) }))}
      />

      {loading && rows.length === 0 ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No transactions" description="Try changing the period or filter." />
      ) : (
        <section className="card overflow-hidden">
          {/* Keep the previous page visible (dimmed) while the next one loads —
              swapping to skeletons collapses the page height and throws the
              scroll position to the top. */}
          <table className={cn('w-full text-sm transition-opacity duration-150', loading && 'opacity-50 pointer-events-none')}>
            <thead className="text-2xs uppercase tracking-wider text-fg-subtle bg-sunken/60">
              <tr>
                <th className="text-left pl-5 pr-2 py-2.5">Date</th>
                <th className="text-left px-2 py-2.5">Type</th>
                <th className="text-left px-2 py-2.5">Employee</th>
                <th className="text-left px-2 py-2.5">Customer</th>
                <th className="text-left px-2 py-2.5">Product</th>
                <th className="text-right px-2 py-2.5">Qty</th>
                <th className="text-right pl-2 pr-5 py-2.5">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const m = TYPE_META[t.transaction_type] ?? TYPE_META.sale;
                const Icon = m.icon;
                return (
                  <tr key={t.uid} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                    <td className="pl-5 pr-2 py-2 text-2xs text-fg-muted font-mono">{formatDate(t.transaction_date)}</td>
                    <td className="px-2 py-2">
                      <Badge tone={m.tone}><Icon className="w-3 h-3" />{t.transaction_type}</Badge>
                    </td>
                    <td className="px-2 py-2 font-medium">{t.employee_name}</td>
                    <td className="px-2 py-2 text-slate-500 truncate max-w-[200px]">{t.customer_name ?? '—'}</td>
                    <td className="px-2 py-2 text-slate-500 truncate max-w-[180px]">{t.product_name ?? '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.quantity}</td>
                    <td className={cn('pl-2 pr-5 py-2 text-right font-semibold tabular-nums',
                      t.transaction_type === 'return' || t.transaction_type === 'bad_return' ? 'text-rose-600' : ''
                    )}>{formatCurrency(t.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[50, 100, 200, 500]}
          />
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone, icon: Icon }: { label: string; value: string; tone: 'indigo' | 'emerald' | 'amber' | 'sky'; icon: any }) {
  const TONE = {
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600' },
    sky:     { bg: 'bg-sky-50',     text: 'text-sky-600' },
  }[tone];
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="text-xl font-semibold tabular-nums mt-1 text-slate-800 dark:text-slate-100">{value}</div>
        </div>
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', TONE.bg, TONE.text)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}
