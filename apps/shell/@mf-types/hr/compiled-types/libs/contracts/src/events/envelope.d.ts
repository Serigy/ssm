import { z } from 'zod';
/**
 * Every message on the bus is wrapped in this envelope. Consumers dispatch on
 * `type` and MUST tolerate unknown fields inside `data` (forward compatibility)
 * while refusing an unknown major `version` (breaking change).
 */
export declare const eventEnvelopeSchema: z.ZodObject<{
    /** Unique per publication. Consumers dedupe on this — delivery is at-least-once. */
    id: z.ZodString;
    /** Routing key, e.g. "financial.invoice.issued". Lowercase, dot-separated. */
    type: z.ZodString;
    /** Schema major version of `data`. Bump only on a breaking change. */
    version: z.ZodDefault<z.ZodNumber>;
    /** Service that published it, e.g. "financial-svc". */
    source: z.ZodString;
    occurredAt: z.ZodString;
    tenantId: z.ZodString;
    /** Correlates the whole causal chain across services. */
    correlationId: z.ZodString;
    /** The event id that directly caused this one, if any. */
    causationId: z.ZodOptional<z.ZodString>;
    /** Actor who triggered it — null for system-initiated events. */
    actorId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    type: string;
    id: string;
    version: number;
    source: string;
    occurredAt: string;
    tenantId: string;
    correlationId: string;
    actorId: string | null;
    data: Record<string, unknown>;
    causationId?: string | undefined;
}, {
    type: string;
    id: string;
    source: string;
    occurredAt: string;
    tenantId: string;
    correlationId: string;
    data: Record<string, unknown>;
    version?: number | undefined;
    causationId?: string | undefined;
    actorId?: string | null | undefined;
}>;
export type EventEnvelope<T = Record<string, unknown>> = Omit<z.infer<typeof eventEnvelopeSchema>, 'data'> & {
    data: T;
};
//# sourceMappingURL=envelope.d.ts.map