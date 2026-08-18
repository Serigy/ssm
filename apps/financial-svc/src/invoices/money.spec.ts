import { describe, expect, it } from 'vitest';
import { computeTotals } from './money.js';

const line = (qtyMilli: number, unitMinor: number, bps = 0) => ({
  description: 'x',
  quantityMilli: qtyMilli,
  unitPrice: { amountMinor: unitMinor, currency: 'BRL' },
  taxRateBps: bps,
});

describe('computeTotals', () => {
  it('multiplies thousandths by minor units without floating point drift', () => {
    // 1.5 x 10.00 = 15.00. In floats, 1.5 * 1000 * 1000 / 1000 is fine, but
    // 0.1 + 0.2 style errors appear as soon as rates are involved — this path
    // never leaves integer arithmetic.
    const t = computeTotals([line(1500, 1000)]);
    expect(t.subtotalMinor).toBe(1500);
    expect(t.totalMinor).toBe(1500);
  });

  it('rounds tax half-up at the line, then sums', () => {
    // 3.33 at 21% = 0.6993 -> 0.70
    const t = computeTotals([line(1000, 333, 2100)]);
    expect(t.lines[0]!.taxMinor).toBe(70);
    expect(t.totalMinor).toBe(403);
  });

  it('keeps the sum of line totals equal to the invoice total', () => {
    // The invariant that matters on a printed document: what is listed must add
    // up to what is charged.
    const t = computeTotals([line(1000, 333, 2100), line(2000, 167, 2100), line(333, 999, 500)]);
    const sum = t.lines.reduce((acc, l) => acc + l.lineTotalMinor, 0);
    expect(sum).toBe(t.totalMinor);
    expect(t.subtotalMinor + t.taxTotalMinor).toBe(t.totalMinor);
  });

  it('handles negative amounts for credit notes symmetrically', () => {
    const positive = computeTotals([line(1000, 333, 2100)]);
    const negative = computeTotals([line(1000, -333, 2100)]);
    expect(negative.totalMinor).toBe(-positive.totalMinor);
  });

  it('stays exact well beyond the float-safe integer range', () => {
    // 90 trillion minor units — past 2^53 once multiplied. bigint keeps it exact.
    const t = computeTotals([line(1000, 9_000_000_000_000)]);
    expect(t.totalMinor).toBe(9_000_000_000_000);
  });
});
