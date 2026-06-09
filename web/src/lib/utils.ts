import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/**
 * Format a money value.
 *   - Pass the ISO currency code from the data (e.g. plan.currency_code).
 *   - When currency is missing, the number is shown plain (no symbol/prefix).
 *   - No hardcoded default: there is no "house currency" — the data drives it.
 */
export const formatCurrency = (value: number | null | undefined, currency?: string | null) => {
  if (value == null) return '—';
  if (!currency) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
};

/** Compact currency for tight displays (e.g. 2.52M). Falls back to full for < 10k. */
export const formatCurrencyCompact = (value: number | null | undefined, currency?: string | null) => {
  if (value == null) return '—';
  if (Math.abs(value) < 10_000) return formatCurrency(value, currency);
  if (!currency) {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
};

export const formatPercent = (value: number | null | undefined, digits = 1) => {
  if (value == null) return '—';
  return `${value.toFixed(digits)}%`;
};

export const formatDate = (value: string | Date | null | undefined) => {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('en-GB');   // DD/MM/YYYY
};

export const formatDateTime = (value: string | Date | null | undefined) => {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('en-GB');
};
