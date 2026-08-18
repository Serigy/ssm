import type { CreateInvoice, Money } from '@ssm/contracts';

/**
 * All invoice arithmetic, in one place, in integers.
 *
 * Every rounding decision the system makes is here and nowhere else. Scattering
 * `Math.round` through a service is how two endpoints end up disagreeing about
 * a total by one cent, which in a financial module is a reconciliation failure,
 * not a cosmetic bug.
 *
 * Rounding rule: half-up at the line level, then sum. Lines are what appear on
 * the printed document, so they must be the values that add up.
 */

export interface ComputedLine {
  netMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

export interface ComputedTotals {
  lines: ComputedLine[];
  subtotalMinor: number;
  taxTotalMinor: number;
  totalMinor: number;
}

/** Half-up division that stays correct for negatives (credit notes). */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

export function computeTotals(lines: CreateInvoice['lines']): ComputedTotals {
  const computed: ComputedLine[] = [];
  let subtotal = 0n;
  let tax = 0n;

  for (const line of lines) {
    // quantityMilli is thousandths, unitPrice is minor units:
    //   net = quantityMilli * unitPriceMinor / 1000
    const net = divRoundHalfUp(
      BigInt(line.quantityMilli) * BigInt(line.unitPrice.amountMinor),
      1000n,
    );
    const lineTax = divRoundHalfUp(net * BigInt(line.taxRateBps ?? 0), 10_000n);

    computed.push({
      netMinor: Number(net),
      taxMinor: Number(lineTax),
      lineTotalMinor: Number(net + lineTax),
    });

    subtotal += net;
    tax += lineTax;
  }

  return {
    lines: computed,
    subtotalMinor: Number(subtotal),
    taxTotalMinor: Number(tax),
    totalMinor: Number(subtotal + tax),
  };
}

export const money = (amountMinor: number, currency: string): Money => ({
  amountMinor,
  currency: currency.toUpperCase(),
});

/**
 * Guards against a payment in the wrong currency reaching the ledger.
 *
 * Returns a boolean rather than throwing: this module is pure domain
 * arithmetic and has no business deciding an HTTP status. A plain thrown Error
 * would be rendered as a 500 by the exception filter, which tells the caller
 * the server is broken when in fact their request was wrong.
 */
export function isSameCurrency(a: Money, currency: string): boolean {
  return a.currency.toUpperCase() === currency.toUpperCase();
}
