'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  History, Filter, ChevronDown, ChevronRight, Clock, FileText, CheckCircle2, Edit3, Trash2, Lock, Sparkles,
} from 'lucide-react';
import api from '@/lib/api';
import { formatDateTime, cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { Badge, PillTabs } from '@/components/ui/Pill';
import PageHero from '@/components/layout/PageHero';
import { Pagination } from '@/components/ui/Pagination';

interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  changes: string;
  performed_by?: string;
  performed_at: string;
}

const ACTION_META: Record<string, { tone: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple'; icon: React.ComponentType<{ className?: string }> }> = {
  created:           { tone: 'primary',  icon: Sparkles },
  updated:           { tone: 'info',     icon: Edit3 },
  deleted:           { tone: 'danger',   icon: Trash2 },
  activated:         { tone: 'success',  icon: CheckCircle2 },
  submitted:         { tone: 'info',     icon: FileText },
  manager_approved:  { tone: 'success',  icon: CheckCircle2 },
  finance_approved:  { tone: 'success',  icon: CheckCircle2 },
  hr_approved:       { tone: 'success',  icon: CheckCircle2 },
  rejected:          { tone: 'danger',   icon: Trash2 },
  locked:            { tone: 'purple',   icon: Lock },
};

export default function HistoryPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setLoading(true);
    const url = filter === 'all' ? '/audit?limit=500' : `/audit?entity_type=${filter}&limit=500`;
    api.get<unknown, AuditRow[]>(url)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
    setPage(1);
  }, [filter]);

  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.entity_type));
    return Array.from(set).sort();
  }, [rows]);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHero
        eyebrow="Lookup"
        title="Audit"
        emphasis="history"
        subtitle="Immutable log of every change to plans, payouts and approvals."
      />

      <PillTabs
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          ...entityTypes.map((e) => ({ value: e, label: e })),
        ]}
      />

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title="No history entries" description="Actions like creating plans or approving payouts will show up here." />
      ) : (
        <ol className="relative space-y-2 pl-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-px before:bg-border">
          {pagedRows.map((r) => {
            const meta = ACTION_META[r.action] ?? { tone: 'neutral' as const, icon: Clock };
            const Icon = meta.icon;
            const isExpanded = expanded === r.id;
            return (
              <li key={r.id} className="relative">
                <span className={cn('absolute -left-[18px] top-3 w-3.5 h-3.5 rounded-full ring-2 ring-background',
                  meta.tone === 'success' ? 'bg-emerald-400'
                  : meta.tone === 'danger' ? 'bg-rose-400'
                  : meta.tone === 'warning' ? 'bg-amber-400'
                  : meta.tone === 'info' ? 'bg-sky-400'
                  : meta.tone === 'purple' ? 'bg-violet-400'
                  : meta.tone === 'primary' ? 'bg-primary-400'
                  : 'bg-neutral-300'
                )} />
                <article className={cn('card transition-all', isExpanded && 'ring-1 ring-primary/40')}>
                  <button onClick={() => setExpanded(isExpanded ? null : r.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-sunken/60 rounded-xl">
                    <Icon className="w-4 h-4 text-fg-subtle shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone={meta.tone}>{r.action.replace(/_/g, ' ')}</Badge>
                        <Badge tone="soft">{r.entity_type}</Badge>
                        <span className="text-2xs font-mono text-fg-subtle truncate">{r.entity_id}</span>
                      </div>
                      <div className="text-2xs text-fg-muted mt-0.5">
                        {formatDateTime(r.performed_at)} {r.performed_by && <span>· by <span className="text-fg">{r.performed_by}</span></span>}
                      </div>
                    </div>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-fg-subtle" /> : <ChevronRight className="w-4 h-4 text-fg-subtle" />}
                  </button>
                  {isExpanded && r.changes && r.changes !== '{}' && (
                    <pre className="px-4 pb-3 pt-1 text-2xs text-fg font-mono bg-sunken/40 border-t border-line/60 max-h-72 overflow-auto whitespace-pre-wrap">
                      {tryPretty(r.changes)}
                    </pre>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
      )}

      {!loading && rows.length > pageSize && (
        <div className="card overflow-hidden">
          <Pagination
            total={rows.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </div>
      )}
    </div>
  );
}

function tryPretty(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}
