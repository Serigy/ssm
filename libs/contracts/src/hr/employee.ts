import { z } from 'zod';
import { auditSchema, isoDateSchema, moneySchema, uuidSchema } from '../common/primitives.js';

export const employmentStatusSchema = z.enum([
  'applicant',
  'onboarding',
  'active',
  'on_leave',
  'offboarding',
  'terminated',
]);
export type EmploymentStatus = z.infer<typeof employmentStatusSchema>;

export const contractTypeSchema = z.enum([
  'permanent',
  'fixed_term',
  'contractor',
  'intern',
  'apprentice',
]);

/**
 * Fields carrying personal data are flagged so the audit log, the export
 * pipeline and the anonymisation job can find them without a hand-maintained
 * list. See docs/security/data-classification.md.
 */
export const PII_FIELDS = [
  'personalEmail',
  'phone',
  'nationalId',
  'dateOfBirth',
  'address',
  'bankAccount',
] as const;

export const employeeSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    /** Stable internal number, never reused. */
    employeeNumber: z.string(),
    /** Set once the person also has a login. */
    userId: uuidSchema.nullable(),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    workEmail: z.string().email(),
    personalEmail: z.string().email().nullable(),
    phone: z.string().max(40).nullable(),
    dateOfBirth: isoDateSchema.nullable(),
    nationalId: z.string().max(64).nullable(),
    address: z
      .object({
        line1: z.string().max(200),
        line2: z.string().max(200).optional(),
        city: z.string().max(120),
        postalCode: z.string().max(20),
        country: z.string().length(2),
      })
      .nullable(),
    status: employmentStatusSchema,
    contractType: contractTypeSchema,
    jobTitle: z.string().max(200),
    departmentId: uuidSchema.nullable(),
    managerId: uuidSchema.nullable(),
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullable(),
    /** Annual gross. Only returned to holders of hr:payroll:read. */
    salary: moneySchema.nullable(),
    /** Key of the signed contract in the R2 documents bucket. */
    documentKey: z.string().nullable(),
  })
  .merge(auditSchema);
export type Employee = z.infer<typeof employeeSchema>;

/**
 * The projection returned to callers without hr:payroll:read.
 *
 * Every field listed in PII_FIELDS is omitted — omitted, not nulled, so a
 * client can tell "you may not see this" apart from "this is not set".
 * Keep this list and PII_FIELDS in step.
 */
export const employeeSafeSchema = employeeSchema.omit({
  salary: true,
  nationalId: true,
  dateOfBirth: true,
  personalEmail: true,
  phone: true,
  address: true,
});
export type EmployeeSafe = z.infer<typeof employeeSafeSchema>;

export const createEmployeeSchema = employeeSchema
  .pick({
    firstName: true,
    lastName: true,
    workEmail: true,
    personalEmail: true,
    phone: true,
    dateOfBirth: true,
    contractType: true,
    jobTitle: true,
    departmentId: true,
    managerId: true,
    startDate: true,
    salary: true,
  })
  .partial({ personalEmail: true, phone: true, dateOfBirth: true, salary: true });
export type CreateEmployee = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = createEmployeeSchema.partial();
export type UpdateEmployee = z.infer<typeof updateEmployeeSchema>;

export const offboardEmployeeSchema = z.object({
  lastDay: isoDateSchema,
  reason: z.enum(['resignation', 'termination', 'end_of_contract', 'retirement']),
  notes: z.string().max(2000).optional(),
});
export type OffboardEmployee = z.infer<typeof offboardEmployeeSchema>;

export const departmentSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    name: z.string().min(1).max(200),
    parentId: uuidSchema.nullable(),
    headEmployeeId: uuidSchema.nullable(),
  })
  .merge(auditSchema);
export type Department = z.infer<typeof departmentSchema>;

export const employeeFilterSchema = z.object({
  status: employmentStatusSchema.optional(),
  departmentId: uuidSchema.optional(),
  managerId: uuidSchema.optional(),
  q: z.string().max(200).optional(),
});
export type EmployeeFilter = z.infer<typeof employeeFilterSchema>;
