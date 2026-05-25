'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdvancedToggleProps {
  /** Stable id for localStorage persistence. */
  id: string;
  title: string;
  /** Optional subtitle / explanatory text below the title. */
  subtitle?: string;
  /** Optional right-aligned summary (e.g. count chips) shown in the header. */
  summary?: React.ReactNode;
  /** Default state if no value is persisted yet. */
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * A collapsible "Advanced" panel. Remembers open/closed per `id` in localStorage
 * so power users don't have to re-expand every time.
 */
export default function AdvancedToggle({
  id, title, subtitle, summary, defaultOpen = false, children, className,
}: AdvancedToggleProps) {
  const storageKey = `advtoggle:${id}`;
  // Render closed on first paint to avoid SSR hydration mismatch; then read storage.
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored != null) setOpen(stored === '1');
    } catch { /* localStorage unavailable */ }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { window.localStorage.setItem(storageKey, next ? '1' : '0'); }
    catch { /* ignore */ }
  };

  return (
    <section className={cn('border border-line/70 rounded-lg bg-surface', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-sunken/60 rounded-lg transition-colors"
      >
        <div className="text-left min-w-0 flex-1">
          <div className="text-sm font-medium text-fg">{title}</div>
          {subtitle && <div className="text-xs text-fg-muted mt-0.5">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {summary}
          {open
            ? <ChevronDown className="w-4 h-4 text-fg-subtle" />
            : <ChevronRight className="w-4 h-4 text-fg-subtle" />}
        </div>
      </button>
      {hydrated && open && (
        <div className="px-4 pb-4 border-t border-line/60 animate-fade-in">
          {children}
        </div>
      )}
    </section>
  );
}
