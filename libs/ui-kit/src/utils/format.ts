import type { Money } from '@ssm/contracts';

/**
 * Formats the integer-minor-unit Money shape for display.
 *
 * The app never does arithmetic on these — the server sends totals already
 * computed. Formatting is presentation only, which is why it lives in the UI kit.
 */
export function formatMoney(money: Money | null | undefined, locale = 'pt-BR'): string {
  if (!money) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
  }).format(money.amountMinor / 100);
}

/** Quantities travel as thousandths to keep integer arithmetic end to end. */
export function formatQuantity(milli: number, locale = 'pt-BR'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(milli / 1000);
}

export function formatDate(iso: string | null | undefined, locale = 'pt-BR'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined, locale = 'pt-BR'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

/** Basis points to a percentage label: 2100 -> "21%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/** Two-letter monogram for the avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
