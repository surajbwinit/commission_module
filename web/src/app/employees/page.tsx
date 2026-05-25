'use client';
import { useEffect, useState, useMemo } from 'react';
import { Users, Search, Mail, MapPin, Briefcase, DollarSign, Calendar, User as UserIcon } from 'lucide-react';
import api from '@/lib/api';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Pill';
import PageHero from '@/components/layout/PageHero';

interface Employee {
  id: string;
  name: string;
  email: string;
  role_id: string;
  role_name: string;
  territory_id?: string;
  territory_name?: string;
  reports_to?: string;
  base_salary: number;
  hire_date: string;
  is_active: number;
}

export default function PeoplePage() {
  const [rows, setRows] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Employee | null>(null);

  useEffect(() => {
    api.get<unknown, Employee[]>('/employees')
      .then((data) => {
        setRows(data);
        if (data.length > 0) setSelected(data[0]);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const byRole = useMemo(() => {
    const grouped = new Map<string, Employee[]>();
    const filtered = rows.filter((e) => !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.email.toLowerCase().includes(search.toLowerCase()));
    for (const e of filtered) {
      const list = grouped.get(e.role_name) ?? [];
      list.push(e);
      grouped.set(e.role_name, list);
    }
    return Array.from(grouped.entries()).sort();
  }, [rows, search]);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHero
        eyebrow="Lookup"
        title="The"
        emphasis="people"
        subtitle="Employee directory grouped by role."
        actions={
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="input pl-9 w-72"
            />
          </div>
        }
      />

      {loading ? (
        <div className="grid lg:grid-cols-[1fr_360px] gap-4">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title="No people found" description="Sync from your source system or add employees." />
      ) : (
        <div className="grid lg:grid-cols-[1fr_360px] gap-4">
          {/* List */}
          <div className="space-y-4">
            {byRole.map(([role, employees]) => (
              <section key={role} className="card overflow-hidden">
                <header className="px-5 py-3 bg-sunken/60 border-b border-line/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-3.5 h-3.5 text-fg-subtle" />
                    <span className="text-sm font-medium text-fg">{role}</span>
                  </div>
                  <Badge tone="soft">{employees.length}</Badge>
                </header>
                <ul>
                  {employees.map((e) => (
                    <li key={e.id}>
                      <button
                        onClick={() => setSelected(e)}
                        className={cn(
                          'w-full flex items-center gap-3 px-5 py-3 border-b border-line/60 last:border-b-0 hover:bg-sunken/60 transition-colors text-left',
                          selected?.id === e.id && 'bg-primary-50/40'
                        )}
                      >
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-300 to-primary-600 text-white text-xs font-semibold flex items-center justify-center ring-2 ring-white shadow-sm">
                          {e.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-fg truncate">{e.name}</div>
                          <div className="text-2xs text-fg-muted truncate">{e.email}</div>
                        </div>
                        <div className="text-right text-xs text-fg-muted">
                          <div>{e.territory_name ?? '→'}</div>
                          <div className="font-medium text-fg tabular-nums">{formatCurrency(e.base_salary)}</div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {/* Detail */}
          <aside className="hidden lg:block">
            <div className="card sticky top-0 p-5">
              {selected ? (
                <>
                  <div className="text-center pb-4 border-b border-line/60">
                    <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-primary-300 to-primary-600 text-white text-2xl font-semibold flex items-center justify-center ring-4 ring-white shadow-card mb-3">
                      {selected.name.charAt(0)}
                    </div>
                    <div className="text-base font-semibold text-fg">{selected.name}</div>
                    <div className="text-xs text-fg-muted">{selected.role_name}</div>
                  </div>
                  <dl className="mt-4 space-y-2.5 text-sm">
                    <DetailRow icon={Mail}      label="Email">{selected.email}</DetailRow>
                    <DetailRow icon={MapPin}    label="Territory">{selected.territory_name ?? '→'}</DetailRow>
                    <DetailRow icon={DollarSign} label="Base salary"><span className="tabular-nums font-medium">{formatCurrency(selected.base_salary)}</span></DetailRow>
                    <DetailRow icon={Calendar}  label="Hire date">{formatDate(selected.hire_date)}</DetailRow>
                    <DetailRow icon={UserIcon}  label="Status">
                      <Badge tone={selected.is_active === 1 ? 'success' : 'soft'}>{selected.is_active === 1 ? 'Active' : 'Inactive'}</Badge>
                    </DetailRow>
                  </dl>
                </>
              ) : (
                <div className="text-center text-sm text-fg-muted py-10">
                  <UserIcon className="w-8 h-8 mx-auto mb-2 text-fg-subtle" /> Select an employee
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function DetailRow({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-2xs uppercase tracking-wider text-fg-muted font-medium">
        <Icon className="w-3 h-3" /> {label}
      </span>
      <span className="text-fg text-right">{children}</span>
    </div>
  );
}
