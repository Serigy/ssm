import { z } from 'zod';
import { auditSchema, isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

/**
 * Severity drives the SLA clock, so it is a contractual value rather than a
 * priority label someone picks by feel.
 *
 *   sev1  serviço parado ou perda de dados
 *   sev2  degradação com impacto em produção
 *   sev3  demais solicitações
 */
export const severitySchema = z.enum(['sev1', 'sev2', 'sev3']);
export type Severity = z.infer<typeof severitySchema>;

/**
 * Ticket lifecycle.
 *
 *   open ──triar──▶ in_progress ──▶ resolved ──▶ closed
 *                       │  ▲
 *          aguardando ──┘  └── cliente respondeu
 *
 * `waiting_customer` exists as a state and not a flag because it is the only
 * thing that legitimately pauses the resolution clock — the contract cannot
 * hold Serigy to a deadline while waiting on the customer.
 */
export const ticketStatusSchema = z.enum([
  'open',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed',
  'cancelled',
]);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const ticketKindSchema = z.enum(['incident', 'request', 'change', 'problem']);

export const ticketEventSchema = z.object({
  at: isoDateTimeSchema,
  actorId: uuidSchema.nullable(),
  kind: z.enum(['created', 'status', 'comment', 'assigned', 'severity', 'breached']),
  note: z.string().max(2000),
});
export type TicketEvent = z.infer<typeof ticketEventSchema>;

export const ticketSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    /** Sequential per tenant, shown as "#4809". Never reused. */
    number: z.number().int().positive(),
    subject: z.string().min(1).max(300),
    description: z.string().max(10_000),
    kind: ticketKindSchema,
    severity: severitySchema,
    status: ticketStatusSchema,
    environmentId: uuidSchema.nullable(),
    environmentCode: z.string().max(40).nullable(),
    /** HR employee currently responsible. Null while unassigned. */
    assigneeId: uuidSchema.nullable(),
    openedAt: isoDateTimeSchema,
    /** When someone first responded. The SLA the contract states is on this. */
    firstResponseAt: isoDateTimeSchema.nullable(),
    resolvedAt: isoDateTimeSchema.nullable(),
    closedAt: isoDateTimeSchema.nullable(),
    /** Deadline for the first response, computed at opening from the severity. */
    responseDueAt: isoDateTimeSchema,
    /**
     * True once the first response deadline passed without a response.
     * Stored rather than derived: the target may change later, and what
     * matters for the monthly reckoning is the commitment in force at the time.
     */
    responseBreached: z.boolean(),
    /** Minutes spent in waiting_customer, excluded from the resolution clock. */
    pausedMinutes: z.number().int().min(0),
    timeline: z.array(ticketEventSchema).default([]),
  })
  .merge(auditSchema);
export type Ticket = z.infer<typeof ticketSchema>;

export const createTicketSchema = z.object({
  subject: z.string().min(1).max(300),
  description: z.string().max(10_000).default(''),
  kind: ticketKindSchema.default('incident'),
  severity: severitySchema,
  environmentId: uuidSchema.nullable().optional(),
  assigneeId: uuidSchema.nullable().optional(),
});
export type CreateTicket = z.infer<typeof createTicketSchema>;

export const transitionTicketSchema = z.object({
  status: ticketStatusSchema,
  note: z.string().max(2000).optional(),
});
export type TransitionTicket = z.infer<typeof transitionTicketSchema>;

export const assignTicketSchema = z.object({ assigneeId: uuidSchema.nullable() });
export type AssignTicket = z.infer<typeof assignTicketSchema>;

export const ticketFilterSchema = z.object({
  status: ticketStatusSchema.optional(),
  severity: severitySchema.optional(),
  environmentId: uuidSchema.optional(),
  assigneeId: uuidSchema.optional(),
  /** Only those whose first-response deadline has passed unanswered. */
  breached: z.coerce.boolean().optional(),
  q: z.string().max(200).optional(),
});
export type TicketFilter = z.infer<typeof ticketFilterSchema>;

/** Minutes remaining until the response deadline; negative once breached. */
export function minutesToDeadline(responseDueAt: string, now = new Date()): number {
  return Math.round((new Date(responseDueAt).getTime() - now.getTime()) / 60_000);
}
