import { cn } from '@/lib/utils';

interface PageHeroProps {
  title: React.ReactNode;
  /** Kept for back-compat; no longer rendered as serif italic. */
  emphasis?: string;
  subtitle?: React.ReactNode;
  /** Small label above the title — section / breadcrumb / context. */
  eyebrow?: React.ReactNode;
  accessory?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: 'primary' | 'emerald' | 'violet' | 'amber' | 'sky' | 'rose';
  className?: string;
}

export default function PageHero({
  title, emphasis, subtitle, eyebrow, accessory, meta, actions, className,
}: PageHeroProps) {
  return (
    <div className={cn('pb-5 mb-1 border-b', className)}>
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0 flex-1 space-y-1.5">
          {eyebrow && (
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {eyebrow}
            </div>
          )}
          <h1 className="text-2xl md:text-[1.75rem] font-semibold tracking-tight text-foreground leading-tight">
            {title}
            {emphasis && <span className="text-foreground"> {emphasis}</span>}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              {subtitle}
            </p>
          )}
          {meta && <div className="pt-2">{meta}</div>}
        </div>
        {(accessory || actions) && (
          <div className="flex items-center gap-2 shrink-0">
            {accessory}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
