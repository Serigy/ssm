import { z } from 'zod';
import { auditSchema, isoDateSchema, moneySchema, uuidSchema } from '../common/primitives.js';

/**
 * Legal contracts are semi-structured, deeply nested and versioned — which is
 * why legal-svc persists them in MongoDB rather than Postgres. The binary
 * (signed PDF) lives in R2; Mongo holds the metadata and the clause tree.
 */
export const contractStatusSchema = z.enum([
  'draft',
  'in_review',
  'awaiting_signature',
  'active',
  'expired',
  'terminated',
]);
export type ContractStatus = z.infer<typeof contractStatusSchema>;

export const contractKindSchema = z.enum([
  'nda',
  'service_agreement',
  'employment',
  'lease',
  'supplier',
  'license',
  'other',
]);

export const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

/** A clause node. Clauses nest arbitrarily deep, hence the recursive type. */
export interface Clause {
  id: string;
  /** Numbering as it appears in the document, e.g. "4.2.1". */
  ordinal: string;
  heading: string;
  body: string;
  risk: z.infer<typeof riskLevelSchema> | null;
  /** Free-form tags used by search and by the obligations report. */
  tags: string[];
  children: Clause[];
}

export const clauseSchema: z.ZodType<Clause> = z.lazy(() =>
  z.object({
    id: z.string(),
    ordinal: z.string().max(20),
    heading: z.string().max(500),
    body: z.string(),
    risk: riskLevelSchema.nullable(),
    tags: z.array(z.string().max(60)),
    children: z.array(clauseSchema),
  }),
);

export const partySchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(300),
  role: z.enum(['first_party', 'counterparty', 'guarantor', 'witness']),
  /** Links to an HR employee or a financial counterparty when one exists. */
  externalRef: z.string().max(200).nullable(),
});

export const obligationSchema = z.object({
  id: uuidSchema,
  clauseId: z.string(),
  description: z.string().max(1000),
  owner: z.enum(['us', 'counterparty']),
  dueDate: isoDateSchema.nullable(),
  recurrence: z.enum(['once', 'monthly', 'quarterly', 'annually']).default('once'),
  amount: moneySchema.nullable(),
  fulfilled: z.boolean().default(false),
});
export type Obligation = z.infer<typeof obligationSchema>;

export const contractVersionSchema = z.object({
  version: z.number().int().min(1),
  createdAt: z.string().datetime({ offset: true }),
  createdBy: uuidSchema.nullable(),
  note: z.string().max(1000).optional(),
  /** R2 key of the document as it stood at this version. */
  documentKey: z.string().nullable(),
  clauses: z.array(clauseSchema),
});

export const contractSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    /** Human reference, unique per tenant, e.g. "NDA-2026-0042". */
    reference: z.string().max(64),
    title: z.string().min(1).max(300),
    kind: contractKindSchema,
    status: contractStatusSchema,
    parties: z.array(partySchema).min(1),
    governingLaw: z.string().max(120).nullable(),
    jurisdiction: z.string().max(120).nullable(),
    effectiveFrom: isoDateSchema.nullable(),
    effectiveTo: isoDateSchema.nullable(),
    /** Days before effectiveTo at which legal.contract.expiring fires. */
    renewalNoticeDays: z.number().int().min(0).max(365).default(30),
    autoRenew: z.boolean().default(false),
    value: moneySchema.nullable(),
    risk: riskLevelSchema.nullable(),
    tags: z.array(z.string().max(60)).default([]),
    /** Current version number; full history in `versions`. */
    currentVersion: z.number().int().min(1),
    clauses: z.array(clauseSchema).default([]),
    obligations: z.array(obligationSchema).default([]),
    documentKey: z.string().nullable(),
  })
  .merge(auditSchema);
export type Contract = z.infer<typeof contractSchema>;

export const createContractSchema = z.object({
  title: z.string().min(1).max(300),
  kind: contractKindSchema,
  parties: z.array(partySchema.omit({ id: true })).min(1),
  governingLaw: z.string().max(120).optional(),
  jurisdiction: z.string().max(120).optional(),
  effectiveFrom: isoDateSchema.optional(),
  effectiveTo: isoDateSchema.optional(),
  renewalNoticeDays: z.number().int().min(0).max(365).optional(),
  autoRenew: z.boolean().optional(),
  value: moneySchema.optional(),
  tags: z.array(z.string().max(60)).optional(),
});
export type CreateContract = z.infer<typeof createContractSchema>;

export const updateContractSchema = createContractSchema.partial();
export type UpdateContract = z.infer<typeof updateContractSchema>;

export const contractFilterSchema = z.object({
  status: contractStatusSchema.optional(),
  kind: contractKindSchema.optional(),
  risk: riskLevelSchema.optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  tag: z.string().max(60).optional(),
  q: z.string().max(200).optional(),
});
export type ContractFilter = z.infer<typeof contractFilterSchema>;

/** Presigned upload/download ticket issued by legal-svc for R2. */
export const documentTicketSchema = z.object({
  url: z.string().url(),
  key: z.string(),
  expiresAt: z.string().datetime({ offset: true }),
  method: z.enum(['GET', 'PUT']),
  headers: z.record(z.string()).optional(),
});
export type DocumentTicket = z.infer<typeof documentTicketSchema>;
