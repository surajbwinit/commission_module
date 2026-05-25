'use client';
import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { glossary, type GlossaryKey } from '@/lib/glossary';
import { cn } from '@/lib/utils';

interface TipProps {
  /** Glossary key — looks up label + tip from `glossary.ts`. */
  k?: GlossaryKey;
  /** Override the tip text directly (skips the glossary lookup). */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Inline tooltip next to a jargon term.
 *
 * Usage:
 *   <Tip k="slab" />                  // shows ? icon → tooltip with glossary content
 *   <Tip>Custom tooltip text</Tip>    // shows ? icon → custom text
 */
export default function Tip({ k, children, className }: TipProps) {
  const [open, setOpen] = useState(false);
  const entry = k ? glossary[k] : null;
  const content = children ?? (
    entry && (
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-neutral-400 dark:text-fg-subtle">{entry.label}</div>
        <div className="text-sm">{entry.tip}</div>
        {entry.example && (
          <div className="text-xs text-neutral-400 dark:text-fg-subtle italic pt-1">e.g. {entry.example}</div>
        )}
      </div>
    )
  );
  if (!content) return null;
  return (
    <span className={cn('relative inline-flex', className)}>
      <button
        type="button"
        aria-label="What does this mean?"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-fg-subtle hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-500/15 transition-colors"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-5 top-0 z-50 w-64 px-3 py-2 bg-popover text-popover-foreground border rounded-md shadow-md text-left"
        >
          {content}
        </span>
      )}
    </span>
  );
}
