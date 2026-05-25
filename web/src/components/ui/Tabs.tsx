'use client';
import { cn } from '@/lib/utils';

interface TabsProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; count?: number; icon?: React.ComponentType<{ className?: string }> }[];
  className?: string;
}

export function Tabs<T extends string>({ value, onChange, options, className }: TabsProps<T>) {
  return (
    <div className={cn(
      'flex items-center gap-1 border-b -mb-px overflow-x-auto',
      className
    )}>
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'group inline-flex items-center gap-2 px-3.5 h-10 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            {Icon && <Icon className={cn('h-4 w-4', active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')} />}
            <span>{opt.label}</span>
            {opt.count != null && (
              <span className={cn(
                'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded text-[10px] font-semibold tabular-nums',
                active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
              )}>{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
