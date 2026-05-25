'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, FileText, Calculator, FlaskConical, CheckCircle,
  Users, Database, History, BookOpen, Receipt
} from 'lucide-react';
import { cn } from '@/lib/utils';

const nav = [
  { href: '/dashboard',    label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/plans',        label: 'Plans',       icon: FileText },
  { href: '/kpis',         label: 'KPI Library', icon: BookOpen },
  { href: '/calculate',    label: 'Calculate',   icon: Calculator },
  { href: '/simulate',     label: 'Simulate',    icon: FlaskConical },
  { href: '/approvals',    label: 'Approvals',   icon: CheckCircle },
  { href: '/audit',        label: 'Audit Trail', icon: History },
  { href: '/employees',    label: 'Employees',   icon: Users },
  { href: '/transactions', label: 'Transactions', icon: Receipt },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-64 bg-white border-r border-neutral-200 flex flex-col">
      <div className="h-16 flex items-center px-6 border-b border-neutral-200">
        <Database className="w-5 h-5 text-blue-600 mr-2" />
        <span className="font-semibold text-neutral-900">Commission</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
              )}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
