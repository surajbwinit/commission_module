'use client';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';

export default function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const Icon = resolved === 'dark' ? Moon : Sun;

  const options: { value: 'light' | 'dark' | 'system'; label: string; icon: typeof Sun }[] = [
    { value: 'light',  label: 'Light',  icon: Sun },
    { value: 'dark',   label: 'Dark',   icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle theme"
        className={cn(
          'inline-flex items-center justify-center w-9 h-9 rounded-lg',
          'border border-line bg-surface text-fg-muted',
          'hover:bg-sunken hover:text-fg transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30'
        )}
      >
        <Icon className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-40 bg-overlay border border-line rounded-xl shadow-card-xl py-1 z-50 animate-slide-down">
          {options.map((o) => {
            const OptIcon = o.icon;
            const active = theme === o.value;
            return (
              <button
                key={o.value}
                onClick={() => { setTheme(o.value); setOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-sunken transition-colors',
                  active ? 'text-fg' : 'text-fg-muted'
                )}
              >
                <OptIcon className="w-3.5 h-3.5" />
                <span className="flex-1 text-left">{o.label}</span>
                {active && <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
