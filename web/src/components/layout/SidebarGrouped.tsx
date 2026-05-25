'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home as HomeIcon, Play, CheckCircle,
  FileText, BookOpen,
  Users, Receipt, History,
  Sparkles, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

interface NavItem { href: string; label: string; icon: React.ComponentType<{ className?: string }>; }
interface NavGroup { title: string; items: NavItem[]; }

const groups: NavGroup[] = [
  { title: 'Now', items: [
    { href: '/dashboard', label: 'Home',       icon: HomeIcon },
    { href: '/calculate', label: 'Run payout', icon: Play },
    { href: '/simulate',  label: 'Simulate',   icon: Sparkles },
    { href: '/approvals', label: 'Approvals',  icon: CheckCircle },
  ]},
  { title: 'Setup', items: [
    { href: '/plans', label: 'Plans',       icon: FileText },
    { href: '/kpis',  label: 'KPI Library', icon: BookOpen },
  ]},
  { title: 'Lookup', items: [
    { href: '/employees',    label: 'People',       icon: Users },
    { href: '/transactions', label: 'Transactions', icon: Receipt },
    { href: '/audit',        label: 'History',      icon: History },
  ]},
];

export default function SidebarGrouped() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useAppStore();
  const collapsed = sidebarCollapsed;

  return (
    <aside className={cn(
      'shrink-0 flex flex-col bg-background border-r transition-[width] duration-200',
      collapsed ? 'w-[60px]' : 'w-60'
    )}>
      {/* Brand */}
      <div className={cn(
        'h-14 flex items-center border-b',
        collapsed ? 'justify-center px-2' : 'px-4'
      )}>
        <div className="h-7 w-7 rounded-md bg-foreground text-background flex items-center justify-center shrink-0">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        {!collapsed && (
          <div className="ml-2.5 leading-tight">
            <div className="text-sm font-semibold tracking-tight">Commission</div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">WINIT</div>
          </div>
        )}
      </div>

      {/* Groups */}
      <nav className="flex-1 px-2 py-4 space-y-5 overflow-y-auto overflow-x-hidden">
        {groups.map((g) => (
          <div key={g.title}>
            {!collapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {g.title}
              </div>
            )}
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-md text-sm font-medium transition-colors',
                        collapsed ? 'justify-center px-2 h-9' : 'px-2.5 h-9',
                        active
                          ? 'bg-secondary text-secondary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className={cn(
          'mx-2 mb-2 h-9 flex items-center justify-center gap-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors',
          collapsed ? '' : 'px-3'
        )}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /> Collapse</>}
      </button>

      {/* Footer / status */}
      {!collapsed && (
        <footer className="px-4 py-3 border-t text-[10px] text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>v0.6</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="relative inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              connected
            </span>
          </div>
        </footer>
      )}
    </aside>
  );
}
