import { z } from 'zod';

/** Every aggregate in SSM is keyed by a UUID v4/v7. */
export const uuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof uuidSchema>;

/**
 * Money is never a float. It is an integer count of the currency's minor unit
 * plus an ISO-4217 code. 12.34 EUR is { amountMinor: 1234, currency: 'EUR' }.
 * Postgres stores it as (bigint, char(3)); the wire format is this object.
 */
export const moneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().length(3).toUpperCase(),
});
export type Money = z.infer<typeof moneySchema>;

export const isoDateSchema = z.string().date();
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** The tenant a request belongs to. Present on every authenticated call. */
export const tenantIdSchema = uuidSchema;

/** Audit columns carried by every persisted aggregate. */
export const auditSchema = z.object({
  createdAt: isoDateTimeSchema,
  createdBy: uuidSchema.nullable(),
  updatedAt: isoDateTimeSchema,
  updatedBy: uuidSchema.nullable(),
});
export type Audit = z.infer<typeof auditSchema>;

export const SSM_MODULES = ['financial', 'hr', 'legal', 'operations'] as const;
export type SsmModule = (typeof SSM_MODULES)[number];
