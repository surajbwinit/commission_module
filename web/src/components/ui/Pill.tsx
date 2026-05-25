'use client';
import { cn } from '@/lib/utils';

interface PillTabsProps<T extends string> {
  value: T;
  options: { value: T; label: React.ReactNode; count?: number }[];
  onChange: (v: T) => void;
  className?: string;
}

export function PillTabs<T extends string>({ value, options, onChange, className }: PillTabsProps<T>) {
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn('pill', active && 'pill-active')}
          >
            {opt.label}
            {opt.count != null && (
              <span className={cn(
                'inline-flex items-center justify-center min-w-5 h-4 px-1 rounded text-2xs font-semibold',
                active ? 'bg-surface text-primary-700' : 'bg-sunken text-fg-muted'
              )}>{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className }: {
  children: React.ReactNode;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'soft';
  className?: string;
}) {
  return <span className={cn('badge', `badge-${tone}`, className)}>{children}</span>;
}
