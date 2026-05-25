import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export default function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('card relative overflow-hidden p-10 text-center', className)}>
      {/* Subtle decorative halo */}
      <div className="pointer-events-none absolute inset-0 bg-premium-mesh opacity-50" />
      <div className="relative">
        <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-muted text-muted-foreground flex items-center justify-center border shadow-sm">
          <Icon className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-fg mb-1.5 tracking-tight">{title}</h3>
        {description && <p className="text-sm text-fg-muted max-w-md mx-auto leading-relaxed">{description}</p>}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}
