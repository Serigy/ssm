import { z } from 'zod';
/** Every aggregate in SSM is keyed by a UUID v4/v7. */
export declare const uuidSchema: z.ZodString;
export type Uuid = z.infer<typeof uuidSchema>;
/**
 * Money is never a float. It is an integer count of the currency's minor unit
 * plus an ISO-4217 code. 12.34 EUR is { amountMinor: 1234, currency: 'EUR' }.
 * Postgres stores it as (bigint, char(3)); the wire format is this object.
 */
export declare const moneySchema: z.ZodObject<{
    amountMinor: z.ZodNumber;
    currency: z.ZodString;
}, "strip", z.ZodTypeAny, {
    amountMinor: number;
    currency: string;
}, {
    amountMinor: number;
    currency: string;
}>;
export type Money = z.infer<typeof moneySchema>;
export declare const isoDateSchema: z.ZodString;
export declare const isoDateTimeSchema: z.ZodString;
/** The tenant a request belongs to. Present on every authenticated call. */
export declare const tenantIdSchema: z.ZodString;
/** Audit columns carried by every persisted aggregate. */
export declare const auditSchema: z.ZodObject<{
    createdAt: z.ZodString;
    createdBy: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
    updatedBy: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
}, {
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
}>;
export type Audit = z.infer<typeof auditSchema>;
export declare const SSM_MODULES: readonly ["financial", "hr", "legal"];
export type SsmModule = (typeof SSM_MODULES)[number];
//# sourceMappingURL=primitives.d.ts.map