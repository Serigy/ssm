import { z } from 'zod';
import { auditSchema, isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

/**
 * An environment under sustentação — the thing Serigy is paid to keep running.
 *
 * It is the anchor of the whole module: a ticket is about an environment, an
 * SLA is measured per environment, and the contract that defines that SLA
 * names it. Modelling tickets without it would leave the contractual
 * commitment with nothing to attach to.
 */
export const environmentKindSchema = z.enum([
  'production',
  'staging',
  'development',
  'data',
  'legacy',
]);
export type EnvironmentKind = z.infer<typeof environmentKindSchema>;

/**
 * Operational state. Deliberately small: these are the three things an operator
 * needs to tell apart at a glance on the inventory screen.
 *
 *   operational        nothing wrong
 *   incident           something is wrong now, and the SLA clock is running
 *   scheduled_window   planned maintenance — downtime that does NOT count
 *                      against availability, which is why it is a state and
 *                      not a flag
 *   decommissioned     no longer supported; kept for historical reporting
 */
export const environmentStatusSchema = z.enum([
  'operational',
  'incident',
  'scheduled_window',
  'decommissioned',
]);
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;

export const maintenanceWindowSchema = z.object({
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  note: z.string().max(500).optional(),
});
export type MaintenanceWindow = z.infer<typeof maintenanceWindowSchema>;

export const environmentSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    /** Human-facing identifier, unique per tenant: "amb-prod-02". */
    code: z.string().min(3).max(40),
    name: z.string().min(1).max(200),
    kind: environmentKindSchema,
    status: environmentStatusSchema,
    /** Cloud region or datacentre, as the provider names it. */
    region: z.string().max(60).nullable(),
    provider: z.string().max(60).nullable(),
    /**
     * The legal contract that commits Serigy to supporting this environment.
     * A reference, not a foreign key — the contract lives in MongoDB under
     * legal-svc. Reconciled by consuming legal's events; see docs/adr/0004.
     */
    contractRef: z.string().max(64).nullable(),
    /**
     * Monthly availability target in basis points: 9950 == 99,50%.
     * Integer, so the figure the contract states is the figure stored.
     */
    availabilityTargetBps: z.number().int().min(0).max(10_000),
    /** Minutes to first response, by severity. Comes from the contract. */
    responseTargetMinutes: z.object({
      sev1: z.number().int().positive(),
      sev2: z.number().int().positive(),
      sev3: z.number().int().positive(),
    }),
    tags: z.array(z.string().max(60)).default([]),
    nextWindow: maintenanceWindowSchema.nullable(),
    notes: z.string().max(2000).nullable(),
  })
  .merge(auditSchema);
export type Environment = z.infer<typeof environmentSchema>;

export const createEnvironmentSchema = environmentSchema
  .pick({
    code: true,
    name: true,
    kind: true,
    region: true,
    provider: true,
    contractRef: true,
    availabilityTargetBps: true,
    responseTargetMinutes: true,
    tags: true,
    notes: true,
  })
  .partial({ region: true, provider: true, contractRef: true, tags: true, notes: true });
export type CreateEnvironment = z.infer<typeof createEnvironmentSchema>;

export const updateEnvironmentSchema = createEnvironmentSchema.partial();
export type UpdateEnvironment = z.infer<typeof updateEnvironmentSchema>;

export const scheduleWindowSchema = maintenanceWindowSchema;

export const environmentFilterSchema = z.object({
  status: environmentStatusSchema.optional(),
  kind: environmentKindSchema.optional(),
  tag: z.string().max(60).optional(),
  q: z.string().max(200).optional(),
});
export type EnvironmentFilter = z.infer<typeof environmentFilterSchema>;
