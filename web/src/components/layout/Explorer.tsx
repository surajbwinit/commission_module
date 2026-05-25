'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronRight, ChevronDown, ChevronLeft,
  Home, FolderTree, BookOpen, Users, Receipt, History,
  Play, Sparkles, CheckCircle, FileText,
  Settings2, Target, Calculator, Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { useAppStore } from '@/lib/store';

interface PlanLite { id: string; name: string; status: string; }

interface RowProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  href?: string;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
  depth?: number;
  active?: boolean;
  trailing?: React.ReactNode;
}

function Row({ icon: Icon, label, href, expandable, open, onToggle, depth = 0, active, trailing }: RowProps) {
  const router = useRouter();
  const handleClick = () => {
    if (expandable) onToggle?.();
    if (href) router.push(href);
  };
  return (
    <button
      onClick={handleClick}
      className={cn(
        'group w-full flex items-center gap-2 h-8 rounded text-[13px] transition-colors text-left pr-2',
        active
          ? 'bg-accent text-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {expandable ? (
        <span className="inline-flex items-center justify-center h-3 w-3 shrink-0 text-muted-foreground">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      ) : (
        <span className="inline-block w-3 shrink-0" />
      )}
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </div>
  );
}

export default function Explorer() {
  const pathname = usePathname() ?? '';
  const { sidebarCollapsed, toggleSidebar } = useAppStore();

  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [planRootOpen, setPlanRootOpen] = useState(true);
  const [expandedPlanIds, setExpandedPlanIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get<unknown, PlanLite[]>('/plans').then((all) => setPlans(all)).catch(() => setPlans([]));
  }, []);

  // Auto-expand the active plan
  useEffect(() => {
    const m = pathname.match(/^\/plans\/([^/]+)/);
    if (m && m[1] !== 'new') {
      setPlanRootOpen(true);
      setExpandedPlanIds((s) => new Set(s).add(m[1]));
    }
  }, [pathname]);

  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href !== '/' && pathname.startsWith(href + '/')) return true;
    return false;
  };

  const togglePlan = (id: string) => {
    setExpandedPlanIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (sidebarCollapsed) {
    return (
      <aside className="w-12 shrink-0 border-r bg-background flex flex-col items-center py-2 gap-0.5">
        <button onClick={toggleSidebar}
          className="h-8 w-8 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Expand explorer">
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="h-px w-6 bg-border my-1" />
        {[
          { icon: Home, href: '/dashboard',    label: 'Home' },
          { icon: Play, href: '/calculate',    label: 'Run payout' },
          { icon: Sparkles, href: '/simulate', label: 'Simulate' },
          { icon: CheckCircle, href: '/approvals', label: 'Approvals' },
          { icon: FolderTree, href: '/plans', label: 'Plans' },
          { icon: BookOpen, href: '/kpis', label: 'KPI Library' },
          { icon: Users, href: '/employees', label: 'People' },
          { icon: Receipt, href: '/transactions', label: 'Transactions' },
          { icon: History, href: '/audit', label: 'History' },
        ].map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <a key={item.href} href={item.href} title={item.label}
              className={cn(
                'h-8 w-8 inline-flex items-center justify-center rounded transition-colors',
                active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}>
              <Icon className="h-4 w-4" />
            </a>
          );
        })}
      </aside>
    );
  }

  return (
    <aside className="w-60 shrink-0 border-r bg-background flex flex-col overflow-hidden">
      <nav className="flex-1 overflow-y-auto py-2 px-1.5">
        <SectionHeader>Workspace</SectionHeader>
        <Row icon={Home}        label="Home"        href="/dashboard" active={isActive('/dashboard')} />
        <Row icon={Play}        label="Run payout"  href="/calculate" active={isActive('/calculate')} />
        <Row icon={Sparkles}    label="Simulate"    href="/simulate"  active={isActive('/simulate')} />
        <Row icon={CheckCircle} label="Approvals"   href="/approvals" active={isActive('/approvals')} />

        <SectionHeader>Library</SectionHeader>
        <Row
          icon={FolderTree}
          label="Plans"
          trailing={<span className="text-[10px] text-muted-foreground tabular-nums">{plans.length}</span>}
          expandable
          open={planRootOpen}
          onToggle={() => setPlanRootOpen((v) => !v)}
        />
        {planRootOpen && (
          <>
            <Row depth={1} label="All plans" href="/plans" active={pathname === '/plans'} />
            {plans.slice(0, 25).map((p) => (
              <PlanBranch
                key={p.id}
                plan={p}
                pathname={pathname}
                open={expandedPlanIds.has(p.id)}
                onToggle={() => togglePlan(p.id)}
              />
            ))}
            <Row depth={1} label="+ New plan" href="/plans/new" active={pathname === '/plans/new'} />
          </>
        )}
        <Row icon={BookOpen} label="KPI Library" href="/kpis" active={isActive('/kpis')} />

        <SectionHeader>Lookup</SectionHeader>
        <Row icon={Users}    label="People"       href="/employees"    active={isActive('/employees')} />
        <Row icon={Receipt}  label="Transactions" href="/transactions" active={isActive('/transactions')} />
        <Row icon={History}  label="History"      href="/audit"        active={isActive('/audit')} />
      </nav>

      <footer className="px-3 py-2 border-t flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          connected
        </span>
        <button onClick={toggleSidebar} className="hover:text-foreground p-0.5 rounded" title="Collapse">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </footer>
    </aside>
  );
}

function PlanBranch({ plan, pathname, open, onToggle }: {
  plan: PlanLite; pathname: string; open: boolean; onToggle: () => void;
}) {
  const base = `/plans/${plan.id}`;
  const isActivePlan = pathname.startsWith(base);
  const hash = (typeof window !== 'undefined' && pathname.startsWith(base))
    ? window.location.hash.replace('#', '')
    : '';
  return (
    <>
      <Row
        depth={1}
        icon={FileText}
        label={
          <span className="inline-flex items-center gap-1.5">
            <span className="truncate">{plan.name}</span>
            {plan.status === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />}
          </span>
        }
        expandable
        open={open}
        onToggle={onToggle}
        href={base}
        active={isActivePlan && !hash}
      />
      {open && (
        <>
          <Row depth={2} icon={Settings2}  label="Plan basics"  href={`${base}#plan`}        active={isActivePlan && hash === 'plan'} />
          <Row depth={2} icon={Target}     label="KPIs"         href={`${base}#kpis`}        active={isActivePlan && hash === 'kpis'} />
          <Row depth={2} icon={Calculator} label="Calculation"  href={`${base}#calculation`} active={isActivePlan && hash === 'calculation'} />
          <Row depth={2} icon={Filter}     label="Rules"        href={`${base}#rules`}       active={isActivePlan && hash === 'rules'} />
        </>
      )}
    </>
  );
}
