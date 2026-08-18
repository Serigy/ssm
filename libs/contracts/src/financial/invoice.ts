import { z } from 'zod';
import { auditSchema, isoDateSchema, moneySchema, uuidSchema } from '../common/primitives.js';

/**
 * Invoice lifecycle. Transitions are enforced in the domain layer of
 * financial-svc — see docs/modules/financial.md for the state machine.
 *
 *   draft ──issue──> issued ──pay──> paid
 *     │                 │
 *     └──void──> void <─┘
 */
export const invoiceStatusSchema = z.enum(['draft', 'issued', 'partially_paid', 'paid', 'void']);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const invoiceLineSchema = z.object({
  id: uuidSchema,
  description: z.string().min(1).max(500),
  /** Quantity in thousandths, to keep integer arithmetic end to end (1.5 -> 1500). */
  quantityMilli: z.number().int().positive(),
  unitPrice: moneySchema,
  /** Basis points: 2100 == 21%. */
  taxRateBps: z.number().int().min(0).max(10_000).default(0),
  lineTotal: moneySchema,
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

export const invoiceSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    /** Human-facing sequential number, assigned at issue time. Null while draft. */
    number: z.string().nullable(),
    status: invoiceStatusSchema,
    counterpartyId: uuidSchema,
    counterpartyName: z.string(),
    issueDate: isoDateSchema.nullable(),
    dueDate: isoDateSchema,
    currency: z.string().length(3),
    lines: z.array(invoiceLineSchema),
    subtotal: moneySchema,
    taxTotal: moneySchema,
    total: moneySchema,
    amountPaid: moneySchema,
    notes: z.string().max(2000).optional(),
    /** Key of the rendered PDF in the R2 documents bucket. */
    documentKey: z.string().nullable(),
  })
  .merge(auditSchema);
export type Invoice = z.infer<typeof invoiceSchema>;

export const createInvoiceSchema = z.object({
  counterpartyId: uuidSchema,
  counterpartyName: z.string().min(1).max(200),
  dueDate: isoDateSchema,
  currency: z.string().length(3),
  notes: z.string().max(2000).optional(),
  lines: z
    .array(
      invoiceLineSchema.pick({
        description: true,
        quantityMilli: true,
        unitPrice: true,
        taxRateBps: true,
      }),
    )
    .min(1)
    .max(200),
});
export type CreateInvoice = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = createInvoiceSchema.partial();
export type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;

export const recordPaymentSchema = z.object({
  amount: moneySchema,
  paidAt: z.string().datetime({ offset: true }),
  reference: z.string().max(200).optional(),
});
export type RecordPayment = z.infer<typeof recordPaymentSchema>;

export const invoiceFilterSchema = z.object({
  status: invoiceStatusSchema.optional(),
  counterpartyId: uuidSchema.optional(),
  dueBefore: isoDateSchema.optional(),
  dueAfter: isoDateSchema.optional(),
  q: z.string().max(200).optional(),
});
export type InvoiceFilter = z.infer<typeof invoiceFilterSchema>;
