import { cn } from '@/lib/utils';
import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** "default" = subtle card; "elevated" = larger shadow; "glass" = translucent backdrop blur; "hero" = card with decorative halo */
  variant?: 'default' | 'elevated' | 'glass' | 'hero';
}

export function Card({ variant = 'default', className, children, ...rest }: CardProps) {
  const base =
    variant === 'glass'    ? 'card-glass'
    : variant === 'elevated' ? 'card-elevated'
    : variant === 'hero'   ? 'card-hero'
    : 'card';
  return (
    <div className={cn(base, className)} {...rest}>
      {children}
    </div>
  );
}

type CardHeaderProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
};

export function CardHeader({ title, subtitle, actions, className, ...rest }: CardHeaderProps) {
  return (
    <header className={cn('section-head px-5 pt-5', className)} {...rest}>
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

export function CardBody({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-3 hairline bg-sunken/40 rounded-b-xl', className)} {...rest} />;
}
