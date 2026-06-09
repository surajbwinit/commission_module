'use client';
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface RoleLite { uid: string; role_name_en: string; code?: string }
interface EmployeeLite {
  uid: string;
  emp_code?: string;
  name: string;
  email?: string;
  role_uid: string;
  role_name_en?: string;
  role_code?: string;
  sales_office_uid?: string | null;
  sales_office_name?: string | null;
}

interface Plan {
  uid: string;
  roles?: RoleLite[];
  employees?: EmployeeLite[];
}

export default function ScopeCard({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [allRoles, setAllRoles] = useState<RoleLite[]>([]);
  const [allEmployees, setAllEmployees] = useState<EmployeeLite[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set((plan.roles ?? []).map(r => r.uid)));
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set((plan.employees ?? []).map(e => e.uid)));
  const [empSearch, setEmpSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<unknown, RoleLite[]>('/roles').then(setAllRoles).catch(() => setAllRoles([]));
    api.get<unknown, EmployeeLite[]>('/employees').then(setAllEmployees).catch(() => setAllEmployees([]));
  }, []);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, uid: string) => {
    const next = new Set(set);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    setter(next);
  };

  // Employees filtered by selected roles
  const eligibleEmployees = useMemo(() => {
    const pool = selectedRoles.size === 0
      ? allEmployees
      : allEmployees.filter(e => selectedRoles.has(e.role_uid));
    if (!empSearch) return pool;
    const q = empSearch.toLowerCase();
    return pool.filter(e =>
      e.name.toLowerCase().includes(q) ||
      (e.email ?? '').toLowerCase().includes(q) ||
      (e.role_name_en ?? '').toLowerCase().includes(q) ||
      (e.sales_office_name ?? '').toLowerCase().includes(q)
    );
  }, [allEmployees, selectedRoles, empSearch]);

  // Drop selected employees whose role is no longer selected
  useEffect(() => {
    if (selectedRoles.size === 0) return;
    const ok = new Set<string>();
    selectedEmployees.forEach(uid => {
      const emp = allEmployees.find(e => e.uid === uid);
      if (emp && selectedRoles.has(emp.role_uid)) ok.add(uid);
    });
    if (ok.size !== selectedEmployees.size) setSelectedEmployees(ok);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoles, allEmployees]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.uid}/roles`,     { roleUids: Array.from(selectedRoles) });
      await api.put(`/plans/${plan.uid}/employees`, { empUids: Array.from(selectedEmployees) });
      toast.success('Scope saved');
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const sameSet = <T,>(a: Set<T>, b: T[]) =>
    a.size === b.length && b.every(x => a.has(x));

  const dirty =
    !sameSet(selectedRoles,     (plan.roles ?? []).map(r => r.uid))      ||
    !sameSet(selectedEmployees, (plan.employees ?? []).map(e => e.uid));

  const selectAllVisible = () => {
    const next = new Set(selectedEmployees);
    eligibleEmployees.forEach(e => next.add(e.uid));
    setSelectedEmployees(next);
  };
  const clearAll = () => setSelectedEmployees(new Set());

  return (
    <section className="card p-5">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">2. Who does this plan apply to?</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Roles pick the audience. The employee whitelist is optional — leave empty to include every employee with the selected role.
        </p>
      </header>

      <div>
        <div className="text-xs font-semibold uppercase text-slate-500 mb-2">
          Roles <span className="text-slate-400 normal-case font-normal">({selectedRoles.size} selected)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allRoles.map((r) => {
            const on = selectedRoles.has(r.uid);
            return (
              <button
                key={r.uid}
                onClick={() => toggle(selectedRoles, setSelectedRoles, r.uid)}
                className={
                  'px-2.5 py-1 rounded-full text-xs border transition-colors ' +
                  (on
                    ? 'bg-primary-50 border-primary-300 text-primary-700'
                    : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300')
                }
              >
                {r.role_name_en}
              </button>
            );
          })}
        </div>
      </div>

      {/* Employee whitelist — full width below */}
      <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <div className="text-xs font-semibold uppercase text-slate-500">
            Employees{' '}
            <span className="text-slate-400 normal-case font-normal">
              ({selectedEmployees.size === 0
                ? 'all matching role + sales office'
                : `${selectedEmployees.size} selected — only these will be eligible`})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                placeholder="Search name, email, role…"
                className="input text-xs pl-7 w-64 h-7"
              />
            </div>
            <button
              type="button"
              onClick={selectAllVisible}
              disabled={eligibleEmployees.length === 0}
              className="text-2xs text-primary-600 hover:text-primary-700 disabled:opacity-40 px-1.5"
            >
              Select visible
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={selectedEmployees.size === 0}
              className="text-2xs text-slate-500 hover:text-slate-700 disabled:opacity-40 px-1.5"
            >
              Clear
            </button>
          </div>
        </div>

        {selectedRoles.size === 0 ? (
          <div className="text-xs text-slate-400 italic border border-dashed border-slate-200 rounded-lg p-3 text-center dark:border-slate-700">
            Pick at least one role above to narrow the employee list.
          </div>
        ) : eligibleEmployees.length === 0 ? (
          <div className="text-xs text-slate-400 italic border border-dashed border-slate-200 rounded-lg p-3 text-center dark:border-slate-700">
            No employees match the selected role{empSearch ? ' and search' : ''}.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 dark:border-slate-700 dark:divide-slate-800">
            {eligibleEmployees.map((e) => {
              const on = selectedEmployees.has(e.uid);
              return (
                <label
                  key={e.uid}
                  className={
                    'flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer transition-colors ' +
                    (on ? 'bg-primary-50/60 dark:bg-primary-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50')
                  }
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(selectedEmployees, setSelectedEmployees, e.uid)}
                  />
                  <span className="flex-1 truncate">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{e.name}</span>
                    {e.emp_code && <span className="text-slate-400 text-xs ml-2 font-mono">{e.emp_code}</span>}
                    {e.email && <span className="text-slate-400 text-xs ml-2">{e.email}</span>}
                  </span>
                  <span className="text-2xs text-slate-500">{e.role_name_en}</span>
                  {e.sales_office_name && (
                    <span className="text-2xs text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded dark:border-slate-700">
                      {e.sales_office_name}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {dirty && (
        <div className="mt-4 flex justify-end">
          <button onClick={save} disabled={saving} className="btn-primary btn-sm">
            {saving ? 'Saving…' : 'Save scope'}
          </button>
        </div>
      )}
    </section>
  );
}
