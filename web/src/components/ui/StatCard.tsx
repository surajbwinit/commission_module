import { cn } from '@/lib/utils';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface StatCardProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  delta?: { value: number; suffix?: string; direction?: 'up' | 'down' };
  tone?: 'violet' | 'emerald' | 'amber' | 'sky' | 'rose' | 'neutral';
  className?: string;
  hint?: React.ReactNode;
  /** When true, the number is rendered in the display serif. Defaults true. */
  display?: boolean;
}

export default function StatCard({
  icon: Icon, label, value, delta, className, hint, display = true,
}: StatCardProps) {
  const positiveDelta = delta && delta.direction !== 'down';
  return (
    <div className={cn(
      'group rounded-xl border bg-card text-card-foreground shadow-sm p-6 transition-shadow hover:shadow-md',
      className
    )}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-foreground leading-none">
        {value}
      </div>
      {(hint || delta) && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {delta && (
            <span className={cn(
              'inline-flex items-center gap-0.5 font-medium',
              positiveDelta ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            )}>
              {positiveDelta ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(delta.value)}{delta.suffix ?? '%'}
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      )}
    </div>
  );
}
