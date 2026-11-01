import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from '../common/primitives.js';

/**
 * Monthly availability reckoning per environment.
 *
 * This is where the operations module meets the other three: the target comes
 * from the legal contract, the measurement comes from operations, and a breach
 * produces a credit that financial applies to an invoice.
 *
 * Everything is integer. Availability is basis points, downtime is whole
 * minutes, and the credit is minor currency units — the same discipline as
 * money, for the same reason: this figure ends up on an invoice, and a rounding
 * disagreement between the two modules is a dispute with a customer.
 */
export const slaPeriodSchema = z.object({
  /** First day of the month being reckoned, "2026-08-01". */
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  environmentId: uuidSchema,
  environmentCode: z.string().max(40),
  /** Minutes in the month, excluding scheduled windows. */
  measuredMinutes: z.number().int().min(0),
  /** Unplanned downtime, in minutes. Scheduled windows never count. */
  downtimeMinutes: z.number().int().min(0),
  /** Achieved availability in basis points: 9932 == 99,32%. */
  achievedBps: z.number().int().min(0).max(10_000),
  /** The commitment in force during that month, copied at reckoning time. */
  targetBps: z.number().int().min(0).max(10_000),
  breached: z.boolean(),
  /** Credit owed to the customer, computed from the contract's penalty rule. */
  credit: moneySchema.nullable(),
  reckonedAt: isoDateTimeSchema,
});
export type SlaPeriod = z.infer<typeof slaPeriodSchema>;

/**
 * Corpo da apuração mensal.
 *
 * Estava em apps/ops-svc/src/sla/sla.dto.ts. Com o Worker atendendo a mesma
 * rota, duas definições da mesma forma acabariam divergindo — e esta em
 * particular carrega a base de cálculo de um crédito que vira linha de fatura.
 */
export const reckonSlaSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/, 'Use o primeiro dia do mês, como 2026-08-01.'),
  environmentId: uuidSchema,
  /** Mensalidade do contrato — a base sobre a qual a penalidade incide. */
  monthlyFee: moneySchema,
});
export type ReckonSla = z.infer<typeof reckonSlaSchema>;

/**
 * The penalty rule from the seeded contract: 5% of the monthly fee for every
 * 0.5% below target, capped at 20%.
 *
 * It lives in @ssm/contracts rather than inside ops-svc for the same reason
 * computeTotals does: operations computes the credit and financial applies it,
 * and a second implementation would eventually disagree — by an amount that
 * appears on a customer's invoice.
 */
export const PENALTY_RULE = {
  /** Each step below target, in basis points. */
  stepBps: 50,
  /** Percentage of the monthly fee forfeited per step, in basis points. */
  penaltyPerStepBps: 500,
  /** Ceiling, in basis points of the monthly fee. */
  capBps: 2_000,
} as const;

/**
 * Credit owed for a month, in minor units.
 *
 * Integer arithmetic throughout, and the division rounds down — the customer is
 * credited whole steps only, never a fraction of one, which is what "a cada
 * 0,5% abaixo" means.
 */
export function computeSlaCredit(
  achievedBps: number,
  targetBps: number,
  monthlyFeeMinor: number,
): number {
  if (achievedBps >= targetBps) return 0;

  const shortfallBps = targetBps - achievedBps;
  const steps = Math.floor(shortfallBps / PENALTY_RULE.stepBps);
  if (steps === 0) return 0;

  const penaltyBps = Math.min(steps * PENALTY_RULE.penaltyPerStepBps, PENALTY_RULE.capBps);
  // bigint so a large monthly fee cannot lose precision on the multiply.
  return Number((BigInt(monthlyFeeMinor) * BigInt(penaltyBps)) / 10_000n);
}

/** Availability in basis points from measured and downtime minutes. */
export function computeAvailabilityBps(measuredMinutes: number, downtimeMinutes: number): number {
  if (measuredMinutes <= 0) return 10_000;
  const up = Math.max(0, measuredMinutes - downtimeMinutes);
  return Math.floor((up * 10_000) / measuredMinutes);
}
