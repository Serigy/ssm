import type { Money } from '@ssm/contracts';
/**
 * Formats the integer-minor-unit Money shape for display.
 *
 * The app never does arithmetic on these — the server sends totals already
 * computed. Formatting is presentation only, which is why it lives in the UI kit.
 */
export declare function formatMoney(money: Money | null | undefined, locale?: string): string;
/** Quantities travel as thousandths to keep integer arithmetic end to end. */
export declare function formatQuantity(milli: number, locale?: string): string;
export declare function formatDate(iso: string | null | undefined, locale?: string): string;
export declare function formatDateTime(iso: string | null | undefined, locale?: string): string;
/** Basis points to a percentage label: 2100 -> "21%". */
export declare function formatBps(bps: number): string;
/** Two-letter monogram for the avatar. */
export declare function initials(name: string): string;
//# sourceMappingURL=format.d.ts.map