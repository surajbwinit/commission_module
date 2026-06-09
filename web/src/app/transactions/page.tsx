'use client';
import { useEffect, useState } from 'react';
import { Receipt, ShoppingCart, RotateCcw, Wallet, Calendar, Upload } from 'lucide-react';
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
  transaction_type: 'sale' | 'return' | 'collection' | 'crate_load' | 'case_delivery' | 'pallet_handling';
  emp_uid: string;
  customer_uid?: string; customer_name?: string; customer_code?: string;
  product_uid?: string;  product_name?: string;  product_code?: string;
  employee_name: string;
  quantity: number;
  amount: number;
  transaction_date: string;
  period: string;
}

const TYPE_META: Record<string, { tone: 'success' | 'warning' | 'info' | 'soft' | 'primary'; icon: any }> = {
  sale:             { tone: 'success', icon: ShoppingCart },
  return:           { tone: 'warning', icon: RotateCcw },
  collection:       { tone: 'info',    icon: Wallet },
  crate_load:       { tone: 'primary', icon: Receipt },
  case_delivery:    { tone: 'primary', icon: Receipt },
  pallet_handling:  { tone: 'primary', icon: Receipt },
};

export default function TransactionsPage() {
  const period = useAppStore((s) => s.selectedPeriod);
  const [rows, setRows] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'all' | string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setLoading(true);
    api.get<unknown, Tx[]>(`/transactions?period=${period}&limit=500`)
    // NB: server fields are emp_uid / customer_uid / product_uid; joined name+code fields are flattened in
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
    setPage(1);
  }, [period]);

  // Reset to page 1 when filter changes
  useEffect(() => { setPage(1); }, [type]);

  const counts = rows.reduce((acc, t) => { acc[t.transaction_type] = (acc[t.transaction_type] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const filtered = type === 'all' ? rows : rows.filter((t) => t.transaction_type === type);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Summary — across all filtered rows (not just the current page)
  const totals = filtered.reduce((acc, t) => {
    if (t.transaction_type === 'sale')       acc.sale += t.amount;
    if (t.transaction_type === 'return')     acc.return += t.amount;
    if (t.transaction_type === 'collection') acc.collection += t.amount;
    return acc;
  }, { sale: 0, return: 0, collection: 0 });

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
        <SummaryCard tone="indigo"  label="Total rows" value={rows.length.toLocaleString()} icon={Receipt} />
        <SummaryCard tone="emerald" label="Total sales" value={formatCurrency(totals.sale)} icon={ShoppingCart} />
        <SummaryCard tone="amber"   label="Total returns" value={formatCurrency(totals.return)} icon={RotateCcw} />
        <SummaryCard tone="sky"     label="Total collected" value={formatCurrency(totals.collection)} icon={Wallet} />
      </div>

      <PillTabs
        value={type}
        onChange={setType}
        options={[
          { value: 'all',        label: 'All',         count: rows.length },
          { value: 'sale',       label: 'Sales',       count: counts.sale ?? 0 },
          { value: 'return',     label: 'Returns',     count: counts.return ?? 0 },
          { value: 'collection', label: 'Collections', count: counts.collection ?? 0 },
        ]}
      />

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      ) : visible.length === 0 ? (
        <EmptyState icon={Receipt} title="No transactions" description="Try changing the period or filter." />
      ) : (
        <section className="card overflow-hidden">
          <table className="w-full text-sm">
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
              {visible.map((t) => {
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
                      t.transaction_type === 'return' ? 'text-rose-600' : ''
                    )}>{formatCurrency(t.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination
            total={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
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
