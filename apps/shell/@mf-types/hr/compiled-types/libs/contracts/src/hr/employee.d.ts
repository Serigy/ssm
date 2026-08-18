import { z } from 'zod';
export declare const employmentStatusSchema: z.ZodEnum<["applicant", "onboarding", "active", "on_leave", "offboarding", "terminated"]>;
export type EmploymentStatus = z.infer<typeof employmentStatusSchema>;
export declare const contractTypeSchema: z.ZodEnum<["permanent", "fixed_term", "contractor", "intern", "apprentice"]>;
/**
 * Fields carrying personal data are flagged so the audit log, the export
 * pipeline and the anonymisation job can find them without a hand-maintained
 * list. See docs/security/data-classification.md.
 */
export declare const PII_FIELDS: readonly ["personalEmail", "phone", "nationalId", "dateOfBirth", "address", "bankAccount"];
export declare const employeeSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    /** Stable internal number, never reused. */
    employeeNumber: z.ZodString;
    /** Set once the person also has a login. */
    userId: z.ZodNullable<z.ZodString>;
    firstName: z.ZodString;
    lastName: z.ZodString;
    workEmail: z.ZodString;
    personalEmail: z.ZodNullable<z.ZodString>;
    phone: z.ZodNullable<z.ZodString>;
    dateOfBirth: z.ZodNullable<z.ZodString>;
    nationalId: z.ZodNullable<z.ZodString>;
    address: z.ZodNullable<z.ZodObject<{
        line1: z.ZodString;
        line2: z.ZodOptional<z.ZodString>;
        city: z.ZodString;
        postalCode: z.ZodString;
        country: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        line1: string;
        city: string;
        postalCode: string;
        country: string;
        line2?: string | undefined;
    }, {
        line1: string;
        city: string;
        postalCode: string;
        country: string;
        line2?: string | undefined;
    }>>;
    status: z.ZodEnum<["applicant", "onboarding", "active", "on_leave", "offboarding", "terminated"]>;
    contractType: z.ZodEnum<["permanent", "fixed_term", "contractor", "intern", "apprentice"]>;
    jobTitle: z.ZodString;
    departmentId: z.ZodNullable<z.ZodString>;
    managerId: z.ZodNullable<z.ZodString>;
    startDate: z.ZodString;
    endDate: z.ZodNullable<z.ZodString>;
    /** Annual gross. Only returned to holders of hr:payroll:read. */
    salary: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>>;
    /** Key of the signed contract in the R2 documents bucket. */
    documentKey: z.ZodNullable<z.ZodString>;
} & {
    createdAt: z.ZodString;
    createdBy: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
    updatedBy: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "active" | "applicant" | "onboarding" | "on_leave" | "offboarding" | "terminated";
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    id: string;
    tenantId: string;
    departmentId: string | null;
    startDate: string;
    documentKey: string | null;
    personalEmail: string | null;
    phone: string | null;
    nationalId: string | null;
    dateOfBirth: string | null;
    address: {
        line1: string;
        city: string;
        postalCode: string;
        country: string;
        line2?: string | undefined;
    } | null;
    employeeNumber: string;
    userId: string | null;
    firstName: string;
    lastName: string;
    workEmail: string;
    contractType: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice";
    jobTitle: string;
    managerId: string | null;
    endDate: string | null;
    salary: {
        amountMinor: number;
        currency: string;
    } | null;
}, {
    status: "active" | "applicant" | "onboarding" | "on_leave" | "offboarding" | "terminated";
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    id: string;
    tenantId: string;
    departmentId: string | null;
    startDate: string;
    documentKey: string | null;
    personalEmail: string | null;
    phone: string | null;
    nationalId: string | null;
    dateOfBirth: string | null;
    address: {
        line1: string;
        city: string;
        postalCode: string;
        country: string;
        line2?: string | undefined;
    } | null;
    employeeNumber: string;
    userId: string | null;
    firstName: string;
    lastName: string;
    workEmail: string;
    contractType: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice";
    jobTitle: string;
    managerId: string | null;
    endDate: string | null;
    salary: {
        amountMinor: number;
        currency: string;
    } | null;
}>;
export type Employee = z.infer<typeof employeeSchema>;
/**
 * The projection returned to callers without hr:payroll:read.
 *
 * Every field listed in PII_FIELDS is omitted — omitted, not nulled, so a
 * client can tell "you may not see this" apart from "this is not set".
 * Keep this list and PII_FIELDS in step.
 */
export declare const employeeSafeSchema: z.ZodObject<Omit<{
    id: z.ZodString;
    tenantId: z.ZodString;
    /** Stable internal number, never reused. */
    employeeNumber: z.ZodString;
    /** Set once the person also has a login. */
    userId: z.ZodNullable<z.ZodString>;
    firstName: z.ZodString;
    lastName: z.ZodString;
    workEmail: z.ZodString;
    personalEmail: z.ZodNullable<z.ZodString>;
    phone: z.ZodNullable<z.ZodString>;
    dateOfBirth: z.ZodNullable<z.ZodString>;
    nationalId: z.ZodNullable<z.ZodString>;
    address: z.ZodNullable<z.ZodObject<{
        line1: z.ZodString;
        line2: z.ZodOptional<z.ZodString>;
        city: z.ZodString;
        postalCode: z.ZodString;
        country: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        line1: string;
        city: string;
        postalCode: string;
        country: string;
        line2?: string | undefined;
    }, {
        line1: string;
        city: string;
        postalCode: string;
        country: string;
        line2?: string | undefined;
    }>>;
    status: z.ZodEnum<["applicant", "onboarding", "active", "on_leave", "offboarding", "terminated"]>;
    contractType: z.ZodEnum<["permanent", "fixed_term", "contractor", "intern", "apprentice"]>;
    jobTitle: z.ZodString;
    departmentId: z.ZodNullable<z.ZodString>;
    managerId: z.ZodNullable<z.ZodString>;
    startDate: z.ZodString;
    endDate: z.ZodNullable<z.ZodString>;
    /** Annual gross. Only returned to holders of hr:payroll:read. */
    salary: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>>;
    /** Key of the signed contract in the R2 documents bucket. */
    documentKey: z.ZodNullable<z.ZodString>;
} & {
    createdAt: z.ZodString;
    createdBy: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
    updatedBy: z.ZodNullable<z.ZodString>;
}, "personalEmail" | "phone" | "nationalId" | "dateOfBirth" | "address" | "salary">, "strip", z.ZodTypeAny, {
    status: "active" | "applicant" | "onboarding" | "on_leave" | "offboarding" | "terminated";
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    id: string;
    tenantId: string;
    departmentId: string | null;
    startDate: string;
    documentKey: string | null;
    employeeNumber: string;
    userId: string | null;
    firstName: string;
    lastName: string;
    workEmail: string;
    contractType: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice";
    jobTitle: string;
    managerId: string | null;
    endDate: string | null;
}, {
    status: "active" | "applicant" | "onboarding" | "on_leave" | "offboarding" | "terminated";
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    id: string;
    tenantId: string;
    departmentId: string | null;
    startDate: string;
    documentKey: string | null;
    employeeNumber: string;
    userId: string | null;
    firstName: string;
    lastName: string;
    workEmail: string;
    contractType: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice";
    jobTitle: string;
    managerId: string | null;
    endDate: string | null;
}>;
export type EmployeeSafe = z.infer<typeof employeeSafeSchema>;
export declare const createEmployeeSchema: z.ZodObject<{
    departmentId: z.ZodNullable<z.ZodString>;
    startDate: z.ZodString;
    personalEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    dateOfBirth: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    firstName: z.ZodString;
    lastName: z.ZodString;
    workEmail: z.ZodString;
    contractType: z.ZodEnum<["permanent", "fixed_term", "contractor", "intern", "apprentice"]>;
    jobTitle: z.ZodString;
    managerId: z.ZodNullable<z.ZodString>;
    salary: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>>>;
}, "strip", z.ZodTypeAny, {
    departmentId: string | null;
    startDate: string;
    firstName: string;
    lastName: string;
    workEmail: string;
    contractType: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice";
    jobTitle: string;
    managerId: string | null;
    personalEmail?: string | null | undefined;
    phone?: string | null | undefined;
    dateOfBirth?: string | null | undefined;
    salary?: {
        amountMinor: number;
        currency: string;
    } | null | undefined;
}, {
    departmentId: string | null;
    startDate: string;
    firstName: string;
    lastName: string;
    workEmail: string;
    contractType: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice";
    jobTitle: string;
    managerId: string | null;
    personalEmail?: string | null | undefined;
    phone?: string | null | undefined;
    dateOfBirth?: string | null | undefined;
    salary?: {
        amountMinor: number;
        currency: string;
    } | null | undefined;
}>;
export type CreateEmployee = z.infer<typeof createEmployeeSchema>;
export declare const updateEmployeeSchema: z.ZodObject<{
    departmentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    startDate: z.ZodOptional<z.ZodString>;
    personalEmail: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    phone: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    dateOfBirth: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    firstName: z.ZodOptional<z.ZodString>;
    lastName: z.ZodOptional<z.ZodString>;
    workEmail: z.ZodOptional<z.ZodString>;
    contractType: z.ZodOptional<z.ZodEnum<["permanent", "fixed_term", "contractor", "intern", "apprentice"]>>;
    jobTitle: z.ZodOptional<z.ZodString>;
    managerId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    salary: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>>>>;
}, "strip", z.ZodTypeAny, {
    departmentId?: string | null | undefined;
    startDate?: string | undefined;
    personalEmail?: string | null | undefined;
    phone?: string | null | undefined;
    dateOfBirth?: string | null | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    workEmail?: string | undefined;
    contractType?: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice" | undefined;
    jobTitle?: string | undefined;
    managerId?: string | null | undefined;
    salary?: {
        amountMinor: number;
        currency: string;
    } | null | undefined;
}, {
    departmentId?: string | null | undefined;
    startDate?: string | undefined;
    personalEmail?: string | null | undefined;
    phone?: string | null | undefined;
    dateOfBirth?: string | null | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    workEmail?: string | undefined;
    contractType?: "permanent" | "fixed_term" | "contractor" | "intern" | "apprentice" | undefined;
    jobTitle?: string | undefined;
    managerId?: string | null | undefined;
    salary?: {
        amountMinor: number;
        currency: string;
    } | null | undefined;
}>;
export type UpdateEmployee = z.infer<typeof updateEmployeeSchema>;
export declare const offboardEmployeeSchema: z.ZodObject<{
    lastDay: z.ZodString;
    reason: z.ZodEnum<["resignation", "termination", "end_of_contract", "retirement"]>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    reason: "resignation" | "termination" | "end_of_contract" | "retirement";
    lastDay: string;
    notes?: string | undefined;
}, {
    reason: "resignation" | "termination" | "end_of_contract" | "retirement";
    lastDay: string;
    notes?: string | undefined;
}>;
export type OffboardEmployee = z.infer<typeof offboardEmployeeSchema>;
export declare const departmentSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    name: z.ZodString;
    parentId: z.ZodNullable<z.ZodString>;
    headEmployeeId: z.ZodNullable<z.ZodString>;
} & {
    createdAt: z.ZodString;
    createdBy: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
    updatedBy: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    id: string;
    tenantId: string;
    name: string;
    parentId: string | null;
    headEmployeeId: string | null;
}, {
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    id: string;
    tenantId: string;
    name: string;
    parentId: string | null;
    headEmployeeId: string | null;
}>;
export type Department = z.infer<typeof departmentSchema>;
export declare const employeeFilterSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["applicant", "onboarding", "active", "on_leave", "offboarding", "terminated"]>>;
    departmentId: z.ZodOptional<z.ZodString>;
    managerId: z.ZodOptional<z.ZodString>;
    q: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status?: "active" | "applicant" | "onboarding" | "on_leave" | "offboarding" | "terminated" | undefined;
    departmentId?: string | undefined;
    q?: string | undefined;
    managerId?: string | undefined;
}, {
    status?: "active" | "applicant" | "onboarding" | "on_leave" | "offboarding" | "terminated" | undefined;
    departmentId?: string | undefined;
    q?: string | undefined;
    managerId?: string | undefined;
}>;
export type EmployeeFilter = z.infer<typeof employeeFilterSchema>;
//# sourceMappingURL=employee.d.ts.map