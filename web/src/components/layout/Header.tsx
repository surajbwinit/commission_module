'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Calendar, ChevronRight, LogOut, ShieldCheck } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import ThemeToggle from '@/components/theme/ThemeToggle';
import Modal from '@/components/ui/Modal';

// The portal is operated by the back-office only — everyone works as admin.
// (The old employee "view as" persona dropdown was removed on request.)
const ADMIN_PERSONA = {
  uid: 'admin',
  name: 'Admin',
  role_code: 'ADMIN',
  role_name: 'Administrator',
};

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
  const router = useRouter();
  const { selectedPeriod, setSelectedPeriod, currentPersona, setPersona, logout } = useAppStore();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const handleLogout = () => {
    setConfirmLogout(false);
    logout();
    toast.success('You have been signed out.');
    router.replace('/login');
  };

  // Pin the session to the admin persona so downstream pages (dashboard,
  // approvals) always get the full admin experience.
  useEffect(() => {
    if (currentPersona?.uid !== ADMIN_PERSONA.uid) setPersona(ADMIN_PERSONA);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {/* Signed-in identity — fixed admin, no switching */}
      <div className="inline-flex items-center gap-2.5 h-9 rounded-lg border border-slate-300 bg-white px-2 pr-3 text-sm dark:bg-slate-800 dark:border-slate-700">
        <div className="h-6 w-6 rounded-full bg-primary-600 text-white flex items-center justify-center">
          <ShieldCheck className="h-3.5 w-3.5" />
        </div>
        <div className="hidden sm:flex flex-col items-start leading-tight">
          <span className="text-slate-800 font-medium dark:text-slate-100">Admin</span>
          <span className="text-[10px] text-slate-500">Administrator</span>
        </div>
      </div>

      {/* Sign out */}
      <button
        type="button"
        onClick={() => setConfirmLogout(true)}
        title="Sign out"
        className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-300 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors dark:bg-slate-800 dark:border-slate-700 dark:hover:text-slate-200 dark:hover:bg-slate-700"
      >
        <LogOut className="h-4 w-4" />
      </button>

      <Modal
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Sign out"
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmLogout(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Are you sure you want to sign out? You will need to sign in again to access the portal.
        </p>
      </Modal>
    </header>
  );
}

function formatPeriodLabel(p: string) {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
}
