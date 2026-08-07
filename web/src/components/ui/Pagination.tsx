'use client';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange?: (s: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export function Pagination({
  total, page, pageSize, onPageChange, onPageSizeChange,
  pageSizeOptions = [25, 50, 100, 250], className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to   = Math.min(total, page * pageSize);

  const go = (p: number) => {
    const clamped = Math.max(1, Math.min(totalPages, p));
    if (clamped !== page) onPageChange(clamped);
  };

  return (
    <div className={cn(
      'flex items-center justify-between gap-4 px-4 py-2.5 border-t text-xs text-muted-foreground',
      className
    )}>
      <div className="flex items-center gap-3">
        <span>
          Showing <span className="text-foreground font-medium tabular-nums">{from.toLocaleString()}</span>
          <span className="mx-1">–</span>
          <span className="text-foreground font-medium tabular-nums">{to.toLocaleString()}</span>
          <span className="mx-1">of</span>
          <span className="text-foreground font-medium tabular-nums">{total.toLocaleString()}</span>
        </span>
        {onPageSizeChange && (
          <label className="hidden md:inline-flex items-center gap-1.5">
            <span>Per page</span>
            <span className="relative inline-flex items-center">
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="appearance-none h-7 pl-2.5 pr-7 rounded border bg-background text-xs tabular-nums text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground/60" />
            </span>
          </label>
        )}
      </div>

      <div className="flex items-center gap-1">
        <PageBtn onClick={() => go(1)}        disabled={page <= 1} title="First">
          <ChevronsLeft className="h-3.5 w-3.5" />
        </PageBtn>
        <PageBtn onClick={() => go(page - 1)} disabled={page <= 1} title="Previous">
          <ChevronLeft className="h-3.5 w-3.5" />
        </PageBtn>
        <span className="px-2 tabular-nums">
          Page <span className="text-foreground font-medium">{page}</span> of <span className="text-foreground font-medium">{totalPages}</span>
        </span>
        <PageBtn onClick={() => go(page + 1)} disabled={page >= totalPages} title="Next">
          <ChevronRight className="h-3.5 w-3.5" />
        </PageBtn>
        <PageBtn onClick={() => go(totalPages)} disabled={page >= totalPages} title="Last">
          <ChevronsRight className="h-3.5 w-3.5" />
        </PageBtn>
      </div>
    </div>
  );
}

function PageBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center justify-center h-7 w-7 rounded border bg-background transition-colors',
        disabled
          ? 'text-muted-foreground/40 cursor-not-allowed'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}
