'use client';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Calendar, ChevronDown, Search, ChevronRight, UserX } from 'lucide-react';
import api from '@/lib/api';
import { useAppStore, type Persona } from '@/lib/store';
import { cn } from '@/lib/utils';
import ThemeToggle from '@/components/theme/ThemeToggle';

interface EmployeeRow {
  uid: string;
  name: string;
  role_code: string;
  role_name_en: string;
}

function buildPeriods() {
  const months: string[] = [];
  const now = new Date();
  for (let i = -12; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}
const PERIODS = buildPeriods();

const ROUTE_LABELS: Record<string, string> = {
  '/dashboard':    'Dashboard',
  '/calculate':    'Run payout',
  '/simulate':     'Simulate',
  '/approvals':    'Approvals',
  '/plans':        'Plans',
  '/plans/new':    'New plan',
  '/kpis':         'KPI Library',
  '/employees':    'People',
  '/transactions': 'Transactions',
  '/audit':        'History',
};

export default function Header() {
  const pathname = usePathname() ?? '/';
  const { selectedPeriod, setSelectedPeriod, currentPersona, setPersona } = useAppStore();
  const [personaOpen, setPersonaOpen] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<unknown, EmployeeRow[]>('/employees')
      .then((rows) => {
        const mapped: Persona[] = rows.map((r) => ({
          uid: r.uid, name: r.name, role_code: r.role_code, role_name: r.role_name_en,
        }));
        setPersonas(mapped);
        if (!currentPersona && mapped.length > 0) {
          // Prefer an Admin persona on initial load — they get the full UI.
          const admin = mapped.find((p) =>
            (p.role_code ?? '').toLowerCase() === 'admin' ||
            (p.role_name ?? '').toLowerCase().includes('admin')
          );
          setPersona(admin ?? mapped[0]);
        }
      })
      .catch(() => setPersonas([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPersonaOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Build breadcrumb crumbs from the URL
  const crumbs = (() => {
    const parts = pathname.split('/').filter(Boolean);
    const out: { label: string; href: string }[] = [];
    let acc = '';
    for (const p of parts) {
      acc += '/' + p;
      out.push({ label: ROUTE_LABELS[acc] ?? decodeURIComponent(p), href: acc });
    }
    return out;
  })();

  return (
    <header className="h-16 shrink-0 border-b border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 flex items-center px-6 gap-4">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-500 overflow-hidden">
        {crumbs.map((c, i) => (
          <span key={c.href} className="inline-flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
            <Link href={c.href} className={cn(
              'truncate max-w-[200px] transition-colors',
              i === crumbs.length - 1
                ? 'text-slate-800 font-semibold dark:text-slate-100'
                : 'hover:text-slate-700 dark:hover:text-slate-300'
            )}>{c.label}</Link>
          </span>
        ))}
      </nav>

      <div className="flex-1" />

      {/* Period selector */}
      <div className="relative">
        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <select
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
          className="input h-9 pl-9 pr-7 min-w-[140px] text-sm cursor-pointer"
        >
          {PERIODS.map((p) => <option key={p} value={p}>{formatPeriodLabel(p)}</option>)}
        </select>
      </div>

      <ThemeToggle />

      {/* Persona */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setPersonaOpen((v) => !v)}
          disabled={personas.length === 0}
          className={cn(
            'inline-flex items-center gap-2.5 h-9 rounded-lg border border-slate-300 bg-white px-2 pr-3 text-sm',
            'hover:bg-slate-50 transition-colors',
            'dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700',
            personaOpen && 'bg-slate-50 dark:bg-slate-700',
            personas.length === 0 && 'opacity-60 cursor-not-allowed'
          )}
        >
          <div className="h-6 w-6 rounded-full bg-primary-600 text-white text-[10px] font-semibold flex items-center justify-center">
            {currentPersona ? currentPersona.name.charAt(0).toUpperCase() : <UserX className="h-3 w-3" />}
          </div>
          <div className="hidden sm:flex flex-col items-start leading-tight">
            <span className="text-slate-800 font-medium truncate max-w-[140px] dark:text-slate-100">
              {currentPersona?.name ?? (loading ? 'Loading…' : 'No users')}
            </span>
            <span className="text-[10px] text-slate-500 truncate max-w-[140px]">
              {currentPersona?.role_name ?? (loading ? '' : 'Run ETL to sync employees')}
            </span>
          </div>
          <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform', personaOpen && 'rotate-180')} />
        </button>

        {personaOpen && personas.length > 0 && (
          <div className="absolute right-0 top-full mt-1.5 w-72 bg-white border border-slate-200 rounded-lg shadow-md py-1 z-50 dark:bg-slate-800 dark:border-slate-700">
            <div className="px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-slate-500 font-semibold border-b border-slate-100 dark:border-slate-700">
              View as
            </div>
            <div className="max-h-80 overflow-y-auto">
              {personas.map((p) => (
                <button
                  key={p.uid}
                  onClick={() => { setPersona(p); setPersonaOpen(false); }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                    'hover:bg-slate-50 dark:hover:bg-slate-700',
                    currentPersona?.uid === p.uid && 'bg-slate-50 dark:bg-slate-700'
                  )}
                >
                  <div className="h-7 w-7 rounded-full bg-slate-100 text-slate-700 text-[10px] font-semibold flex items-center justify-center dark:bg-slate-700 dark:text-slate-200">
                    {p.name.charAt(0)}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.role_name}</div>
                  </div>
                  {currentPersona?.uid === p.uid && <div className="h-1.5 w-1.5 rounded-full bg-primary-600" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function formatPeriodLabel(p: string) {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
}
