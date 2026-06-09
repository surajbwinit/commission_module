'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, FileText, Target, Calculator, FlaskConical,
  CheckCircle2, ScrollText, Users, Receipt,
  ChevronLeft, ChevronRight, Banknote,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

const navItems = [
  { to: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/plans',        icon: FileText,        label: 'Plans' },
  { to: '/kpis',         icon: Target,          label: 'KPI Library' },
  { to: '/calculate',    icon: Calculator,      label: 'Calculate' },
  { to: '/simulate',     icon: FlaskConical,    label: 'Simulate' },
  { to: '/approvals',    icon: CheckCircle2,    label: 'Approvals' },
  { to: '/audit',        icon: ScrollText,      label: 'Audit Trail' },
  { to: '/employees',    icon: Users,           label: 'Employees' },
  { to: '/transactions', icon: Receipt,         label: 'Transactions' },
];

export default function Explorer() {
  const pathname = usePathname() ?? '';
  const { sidebarCollapsed, toggleSidebar } = useAppStore();

  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href !== '/' && pathname.startsWith(href + '/')) return true;
    return false;
  };

  return (
    <aside
      className={cn(
        'bg-white text-slate-700 flex flex-col flex-shrink-0 border-r border-slate-200',
        'transition-all duration-200 ease-in-out',
        'dark:bg-slate-900 dark:text-slate-200 dark:border-slate-800',
        sidebarCollapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="h-9 w-9 rounded-lg bg-primary-600 text-white flex items-center justify-center flex-shrink-0">
          <Banknote className="w-5 h-5" />
        </div>
        {!sidebarCollapsed && (
          <div className="ml-3 leading-tight">
            <span className="text-[10.5px] font-semibold text-slate-500 tracking-[0.12em] uppercase block">WINIT</span>
            <span className="text-base font-bold text-slate-800 dark:text-slate-100 tracking-tight">CommissionIQ</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-0.5 px-2.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);
          return (
            <Link
              key={item.to}
              href={item.to}
              title={sidebarCollapsed ? item.label : undefined}
              className={cn(
                'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                active
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                sidebarCollapsed && 'justify-center'
              )}
            >
              {/* Active indicator bar on the left */}
              {active && !sidebarCollapsed && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-primary-600" />
              )}
              <Icon className={cn(
                'w-4.5 h-4.5 flex-shrink-0 transition-colors',
                active ? 'text-primary-600 dark:text-primary-400' : ''
              )} />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer: status + collapse toggle */}
      <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-3 flex items-center justify-between">
        {!sidebarCollapsed && (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-slate-500">
            <span className="relative inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="absolute inset-0 h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping opacity-50" />
            </span>
            connected
          </span>
        )}
        <button
          onClick={toggleSidebar}
          className={cn(
            'h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            'dark:hover:bg-slate-800 dark:hover:text-slate-200',
            sidebarCollapsed && 'mx-auto'
          )}
          title={sidebarCollapsed ? 'Expand' : 'Collapse'}
        >
          {sidebarCollapsed
            ? <ChevronRight className="h-3.5 w-3.5" />
            : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>
    </aside>
  );
}
