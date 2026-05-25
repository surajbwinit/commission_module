'use client';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
}

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export default function Modal({ open, onClose, title, description, children, size = 'md', footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-foreground/30 dark:bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative w-full bg-popover text-popover-foreground rounded-xl shadow-lg border animate-scale-in',
          'flex flex-col max-h-[90vh] overflow-hidden',
          SIZE[size]
        )}
      >
        {(title || description) && (
          <header className="shrink-0 px-6 pt-5 pb-3 flex items-start justify-between gap-4 border-b">
            <div>
              {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
              {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
            </div>
            <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <footer className="shrink-0 px-6 py-3 border-t bg-muted/40 flex justify-end gap-2">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
