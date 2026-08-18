import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

/**
 * Every message on the bus is wrapped in this envelope. Consumers dispatch on
 * `type` and MUST tolerate unknown fields inside `data` (forward compatibility)
 * while refusing an unknown major `version` (breaking change).
 */
export const eventEnvelopeSchema = z.object({
  /** Unique per publication. Consumers dedupe on this — delivery is at-least-once. */
  id: uuidSchema,
  /** Routing key, e.g. "financial.invoice.issued". Lowercase, dot-separated. */
  type: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/),
  /** Schema major version of `data`. Bump only on a breaking change. */
  version: z.number().int().min(1).default(1),
  /** Service that published it, e.g. "financial-svc". */
  source: z.string(),
  occurredAt: isoDateTimeSchema,
  tenantId: uuidSchema,
  /** Correlates the whole causal chain across services. */
  correlationId: uuidSchema,
  /** The event id that directly caused this one, if any. */
  causationId: uuidSchema.optional(),
  /** Actor who triggered it — null for system-initiated events. */
  actorId: uuidSchema.nullable().default(null),
  data: z.record(z.unknown()),
});

export type EventEnvelope<T = Record<string, unknown>> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  'data'
> & { data: T };
