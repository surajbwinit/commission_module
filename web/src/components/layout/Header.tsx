'use client';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Calendar, ChevronDown, Search, Sparkles, ChevronRight } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import ThemeToggle from '@/components/theme/ThemeToggle';

const PERSONAS = [
  { id: 'emp-nsm', name: 'Patrick Stillhart',  role: 'CEO',          roleId: 'role-nsm' },
  { id: 'emp-cco', name: 'Umar Farrukh',       role: 'CCO',          roleId: 'role-nsm' },
  { id: 'emp-asm', name: 'Ahmed Hassan',       role: 'ASM',          roleId: 'role-asm' },
  { id: 'emp-ss',  name: 'Mohammed Ali',       role: 'Supervisor',   roleId: 'role-ss' },
  { id: 'emp-sr',  name: 'Fahad Khan',         role: 'Salesman',     roleId: 'role-salesman' },
  { id: 'admin',   name: 'Admin',              role: 'Administrator', roleId: 'role-nsm' },
];

function buildPeriods() {
  const months: string[] = [];
  const now = new Date();
  for (let i = -2; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}
const PERIODS = buildPeriods();

const ROUTE_LABELS: Record<string, string> = {
  '/dashboard':    'Home',
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
  const ref = useRef<HTMLDivElement>(null);

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
    <header className="h-11 shrink-0 border-b bg-background flex items-center gap-3 px-3">
      {/* Brand */}
      <Link href="/dashboard" className="inline-flex items-center gap-2 px-1.5 -ml-0.5 rounded hover:bg-accent h-8">
        <div className="h-5 w-5 rounded-sm bg-foreground text-background flex items-center justify-center">
          <Sparkles className="h-3 w-3" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Commission</span>
      </Link>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground overflow-hidden">
        {crumbs.map((c, i) => (
          <span key={c.href} className="inline-flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
            <Link href={c.href} className={cn(
              'truncate max-w-[180px] hover:text-foreground',
              i === crumbs.length - 1 ? 'text-foreground font-medium' : ''
            )}>{c.label}</Link>
          </span>
        ))}
      </div>

      <div className="flex-1" />

      {/* Period selector */}
      <div className="relative">
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <select
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
          className="input h-8 pl-8 pr-7 min-w-[130px] text-xs cursor-pointer"
        >
          {PERIODS.map((p) => <option key={p} value={p}>{formatPeriodLabel(p)}</option>)}
        </select>
      </div>

      {/* Search (disabled / ⌘K) */}
      <div className="hidden md:block relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          placeholder="Search…"
          className="input h-8 pl-8 pr-12 w-56 text-xs"
          disabled
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2"><span className="kbd">⌘K</span></span>
      </div>

      <ThemeToggle />

      {/* Persona */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setPersonaOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-2 h-8 rounded-md border bg-background px-1.5 pr-2.5 text-xs',
            'hover:bg-accent transition-colors',
            personaOpen && 'bg-accent'
          )}
        >
          <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold flex items-center justify-center">
            {currentPersona.name.charAt(0).toUpperCase()}
          </div>
          <span className="hidden sm:inline text-foreground font-medium truncate max-w-[120px]">{currentPersona.name}</span>
          <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', personaOpen && 'rotate-180')} />
        </button>

        {personaOpen && (
          <div className="absolute right-0 top-full mt-1.5 w-72 bg-popover text-popover-foreground border rounded-md shadow-md py-1 z-50 animate-slide-down">
            <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-semibold">View as</div>
            {PERSONAS.map((p) => (
              <button
                key={p.id}
                onClick={() => { setPersona(p); setPersonaOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-1.5 text-sm hover:bg-accent transition-colors',
                  currentPersona.id === p.id && 'bg-accent'
                )}
              >
                <div className="h-7 w-7 rounded-full bg-muted text-foreground text-[10px] font-semibold flex items-center justify-center">
                  {p.name.charAt(0)}
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.role}</div>
                </div>
                {currentPersona.id === p.id && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>
            ))}
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
