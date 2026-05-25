'use client';
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface RoleLite { id: string; name: string }
interface TerritoryLite { id: string; name: string; type: string }
interface EmployeeLite {
  id: string; name: string; email?: string;
  role_id: string; role_name?: string;
  territory_id?: string | null; territory_name?: string | null;
}

interface Plan {
  id: string;
  roles?: RoleLite[];
  territories?: TerritoryLite[];
  employees?: EmployeeLite[];
}

export default function ScopeCard({ plan, onChange }: { plan: Plan; onChange: () => void }) {
  const [allRoles, setAllRoles] = useState<RoleLite[]>([]);
  const [allTerritories, setAllTerritories] = useState<TerritoryLite[]>([]);
  const [allEmployees, setAllEmployees] = useState<EmployeeLite[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set((plan.roles ?? []).map(r => r.id)));
  const [selectedTerritories, setSelectedTerritories] = useState<Set<string>>(new Set((plan.territories ?? []).map(t => t.id)));
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set((plan.employees ?? []).map(e => e.id)));
  const [empSearch, setEmpSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<unknown, RoleLite[]>('/roles').then(setAllRoles).catch(() => setAllRoles([]));
    api.get<unknown, TerritoryLite[]>('/territories').then(setAllTerritories).catch(() => setAllTerritories([]));
    api.get<unknown, EmployeeLite[]>('/employees').then(setAllEmployees).catch(() => setAllEmployees([]));
  }, []);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  // Employees filtered by selected roles (so the picker only shows relevant people).
  const eligibleEmployees = useMemo(() => {
    const pool = selectedRoles.size === 0
      ? allEmployees
      : allEmployees.filter(e => selectedRoles.has(e.role_id));
    if (!empSearch) return pool;
    const q = empSearch.toLowerCase();
    return pool.filter(e =>
      e.name.toLowerCase().includes(q) ||
      (e.email ?? '').toLowerCase().includes(q) ||
      (e.role_name ?? '').toLowerCase().includes(q) ||
      (e.territory_name ?? '').toLowerCase().includes(q)
    );
  }, [allEmployees, selectedRoles, empSearch]);

  // Drop any selected employees whose role is no longer selected.
  useEffect(() => {
    if (selectedRoles.size === 0) return;
    const ok = new Set<string>();
    selectedEmployees.forEach(id => {
      const emp = allEmployees.find(e => e.id === id);
      if (emp && selectedRoles.has(emp.role_id)) ok.add(id);
    });
    if (ok.size !== selectedEmployees.size) setSelectedEmployees(ok);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoles, allEmployees]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/roles`,       { roleIds: Array.from(selectedRoles) });
      await api.put(`/plans/${plan.id}/territories`, { territoryIds: Array.from(selectedTerritories) });
      await api.put(`/plans/${plan.id}/employees`,   { employeeIds: Array.from(selectedEmployees) });
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
    !sameSet(selectedRoles,       (plan.roles ?? []).map(r => r.id))       ||
    !sameSet(selectedTerritories, (plan.territories ?? []).map(t => t.id)) ||
    !sameSet(selectedEmployees,   (plan.employees ?? []).map(e => e.id));

  const selectAllVisible = () => {
    const next = new Set(selectedEmployees);
    eligibleEmployees.forEach(e => next.add(e.id));
    setSelectedEmployees(next);
  };
  const clearAll = () => setSelectedEmployees(new Set());

  return (
    <section className="card p-5">
      <header className="mb-3">
        <h2 className="text-base font-semibold">2. Who does this plan apply to?</h2>
        <p className="text-xs text-fg-muted mt-0.5">
          Roles and territories pick the audience. The employee whitelist is optional — leave empty to include everyone matching role + territory.
        </p>
      </header>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-semibold uppercase text-fg-muted mb-2">
            Roles <span className="text-fg-subtle">({selectedRoles.size} selected)</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allRoles.map((r) => {
              const on = selectedRoles.has(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => toggle(selectedRoles, setSelectedRoles, r.id)}
                  className={
                    'px-2.5 py-1 rounded-full text-xs border transition-colors ' +
                    (on
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'bg-surface border-line text-fg-muted hover:bg-sunken')
                  }
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase text-fg-muted mb-2">
            Territories <span className="text-fg-subtle">({selectedTerritories.size} selected)</span>
          </div>
          <div className="max-h-48 overflow-y-auto border border-line rounded-md p-2 space-y-0.5">
            {allTerritories.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm py-0.5 px-1 hover:bg-sunken rounded">
                <input
                  type="checkbox"
                  checked={selectedTerritories.has(t.id)}
                  onChange={() => toggle(selectedTerritories, setSelectedTerritories, t.id)}
                />
                <span className={'text-' + (t.type === 'national' ? 'neutral-900 font-medium' : t.type === 'region' ? 'neutral-700' : 'neutral-500')}>
                  {t.name}
                </span>
                <span className="ml-auto text-[10px] uppercase text-fg-subtle">{t.type}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Employee whitelist — full width below */}
      <div className="mt-6 pt-4 border-t border-line/60">
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <div className="text-xs font-semibold uppercase text-fg-muted">
            Employees{' '}
            <span className="text-fg-subtle normal-case font-normal">
              ({selectedEmployees.size === 0
                ? 'all matching role + territory'
                : `${selectedEmployees.size} selected — only these will be eligible`})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle" />
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
              className="text-2xs text-primary hover:text-primary/80 disabled:opacity-40 px-1.5"
            >
              Select visible
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={selectedEmployees.size === 0}
              className="text-2xs text-fg-muted hover:text-fg disabled:opacity-40 px-1.5"
            >
              Clear
            </button>
          </div>
        </div>

        {selectedRoles.size === 0 ? (
          <div className="text-xs text-fg-subtle italic border border-dashed border-line rounded-md p-3 text-center">
            Pick at least one role above to narrow the employee list.
          </div>
        ) : eligibleEmployees.length === 0 ? (
          <div className="text-xs text-fg-subtle italic border border-dashed border-line rounded-md p-3 text-center">
            No employees match the selected role{empSearch ? ' and search' : ''}.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto border border-line rounded-md divide-y divide-line/50">
            {eligibleEmployees.map((e) => {
              const on = selectedEmployees.has(e.id);
              return (
                <label
                  key={e.id}
                  className={
                    'flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer transition-colors ' +
                    (on ? 'bg-primary/5' : 'hover:bg-sunken')
                  }
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(selectedEmployees, setSelectedEmployees, e.id)}
                  />
                  <span className="flex-1 truncate">
                    <span className="font-medium text-fg">{e.name}</span>
                    {e.email && <span className="text-fg-subtle text-xs ml-2">{e.email}</span>}
                  </span>
                  <span className="text-2xs text-fg-muted">{e.role_name}</span>
                  {e.territory_name && (
                    <span className="text-2xs text-fg-subtle border border-line px-1.5 py-0.5 rounded">
                      {e.territory_name}
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
