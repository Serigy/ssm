import { z } from 'zod';
import { isoDateSchema, moneySchema, uuidSchema } from '../common/primitives.js';

/**
 * The event catalog. `docs/architecture/events.md` is generated from this file,
 * so adding an event here is what makes it real and documented.
 */

// --- financial -------------------------------------------------------------
export const invoiceIssuedSchema = z.object({
  invoiceId: uuidSchema,
  number: z.string(),
  counterpartyId: uuidSchema,
  total: moneySchema,
  dueDate: isoDateSchema,
});
export const invoicePaidSchema = z.object({
  invoiceId: uuidSchema,
  paidAt: z.string().datetime({ offset: true }),
  amount: moneySchema,
});
export const invoiceVoidedSchema = z.object({
  invoiceId: uuidSchema,
  reason: z.string(),
});

// --- hr --------------------------------------------------------------------
export const employeeHiredSchema = z.object({
  employeeId: uuidSchema,
  personName: z.string(),
  departmentId: uuidSchema.nullable(),
  startDate: isoDateSchema,
});
export const employeeOffboardedSchema = z.object({
  employeeId: uuidSchema,
  lastDay: isoDateSchema,
  reason: z.enum(['resignation', 'termination', 'end_of_contract', 'retirement']),
});

// --- legal -----------------------------------------------------------------
export const contractActivatedSchema = z.object({
  contractId: uuidSchema,
  reference: z.string(),
  counterpartyId: uuidSchema,
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.nullable(),
});
export const contractExpiringSchema = z.object({
  contractId: uuidSchema,
  reference: z.string(),
  expiresOn: isoDateSchema,
  daysRemaining: z.number().int(),
});

// --- operations ------------------------------------------------------------
export const incidentOpenedSchema = z.object({
  ticketId: uuidSchema,
  number: z.number().int(),
  severity: z.enum(['sev1', 'sev2', 'sev3']),
  environmentId: uuidSchema.nullable(),
  environmentCode: z.string().nullable(),
  responseDueAt: z.string().datetime({ offset: true }),
});
export const incidentResolvedSchema = z.object({
  ticketId: uuidSchema,
  number: z.number().int(),
  environmentId: uuidSchema.nullable(),
  minutesToResolve: z.number().int(),
  responseBreached: z.boolean(),
});
export const environmentProvisionedSchema = z.object({
  environmentId: uuidSchema,
  code: z.string(),
  kind: z.string(),
  contractRef: z.string().nullable(),
});
/**
 * The event that crosses the whole system: operations measured a month below
 * the target the legal contract committed to, and financial owes the customer
 * a credit for it.
 */
export const slaBreachedSchema = z.object({
  environmentId: uuidSchema,
  environmentCode: z.string(),
  month: z.string(),
  targetBps: z.number().int(),
  achievedBps: z.number().int(),
  downtimeMinutes: z.number().int(),
  credit: moneySchema,
  contractRef: z.string().nullable(),
});

export const EVENT_CATALOG = {
  'financial.invoice.issued': invoiceIssuedSchema,
  'financial.invoice.paid': invoicePaidSchema,
  'financial.invoice.voided': invoiceVoidedSchema,
  'hr.employee.hired': employeeHiredSchema,
  'hr.employee.offboarded': employeeOffboardedSchema,
  'legal.contract.activated': contractActivatedSchema,
  'legal.contract.expiring': contractExpiringSchema,
  'operations.incident.opened': incidentOpenedSchema,
  'operations.incident.resolved': incidentResolvedSchema,
  'operations.environment.provisioned': environmentProvisionedSchema,
  'operations.sla.breached': slaBreachedSchema,
} as const;

export type EventType = keyof typeof EVENT_CATALOG;
export type EventPayload<T extends EventType> = z.infer<(typeof EVENT_CATALOG)[T]>;

/** Runtime guard used by consumers before they touch `data`. */
export function parseEventPayload<T extends EventType>(type: T, data: unknown): EventPayload<T> {
  return EVENT_CATALOG[type].parse(data) as EventPayload<T>;
}
