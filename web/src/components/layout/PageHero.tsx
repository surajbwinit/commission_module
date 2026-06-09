import { cn } from '@/lib/utils';

interface PageHeroProps {
  title: React.ReactNode;
  /** Back-compat — appended to title as plain text. */
  emphasis?: string;
  subtitle?: React.ReactNode;
  /** Back-compat — rendered as a small uppercase label above the title. */
  eyebrow?: React.ReactNode;
  accessory?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Standard page header — matches the old reference UI:
 *   h1 text-2xl font-bold slate-800
 *   subtitle text-sm slate-500
 *   actions row on the right
 *
 * Flat, no decorative gradients or serif accents.
 */
export default function PageHero({
  title, emphasis, subtitle, eyebrow, accessory, meta, actions, className,
}: PageHeroProps) {
  return (
    <div className={cn('mb-5', className)}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 mb-1.5">
              {eyebrow}
            </div>
          )}
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight dark:text-slate-100">
            {title}
            {emphasis && <span className="text-slate-800 dark:text-slate-100"> {emphasis}</span>}
          </h1>
          {subtitle && (
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              {subtitle}
            </p>
          )}
          {meta && <div className="mt-3">{meta}</div>}
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
