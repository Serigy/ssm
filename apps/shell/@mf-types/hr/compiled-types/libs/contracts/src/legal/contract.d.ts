import { z } from 'zod';
/**
 * Legal contracts are semi-structured, deeply nested and versioned — which is
 * why legal-svc persists them in MongoDB rather than Postgres. The binary
 * (signed PDF) lives in R2; Mongo holds the metadata and the clause tree.
 */
export declare const contractStatusSchema: z.ZodEnum<["draft", "in_review", "awaiting_signature", "active", "expired", "terminated"]>;
export type ContractStatus = z.infer<typeof contractStatusSchema>;
export declare const contractKindSchema: z.ZodEnum<["nda", "service_agreement", "employment", "lease", "supplier", "license", "other"]>;
export declare const riskLevelSchema: z.ZodEnum<["low", "medium", "high", "critical"]>;
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
export declare const clauseSchema: z.ZodType<Clause>;
export declare const partySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    role: z.ZodEnum<["first_party", "counterparty", "guarantor", "witness"]>;
    /** Links to an HR employee or a financial counterparty when one exists. */
    externalRef: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    role: "first_party" | "counterparty" | "guarantor" | "witness";
    externalRef: string | null;
}, {
    id: string;
    name: string;
    role: "first_party" | "counterparty" | "guarantor" | "witness";
    externalRef: string | null;
}>;
export declare const obligationSchema: z.ZodObject<{
    id: z.ZodString;
    clauseId: z.ZodString;
    description: z.ZodString;
    owner: z.ZodEnum<["us", "counterparty"]>;
    dueDate: z.ZodNullable<z.ZodString>;
    recurrence: z.ZodDefault<z.ZodEnum<["once", "monthly", "quarterly", "annually"]>>;
    amount: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>>;
    fulfilled: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    id: string;
    dueDate: string | null;
    amount: {
        amountMinor: number;
        currency: string;
    } | null;
    description: string;
    clauseId: string;
    owner: "counterparty" | "us";
    recurrence: "once" | "monthly" | "quarterly" | "annually";
    fulfilled: boolean;
}, {
    id: string;
    dueDate: string | null;
    amount: {
        amountMinor: number;
        currency: string;
    } | null;
    description: string;
    clauseId: string;
    owner: "counterparty" | "us";
    recurrence?: "once" | "monthly" | "quarterly" | "annually" | undefined;
    fulfilled?: boolean | undefined;
}>;
export type Obligation = z.infer<typeof obligationSchema>;
export declare const contractVersionSchema: z.ZodObject<{
    version: z.ZodNumber;
    createdAt: z.ZodString;
    createdBy: z.ZodNullable<z.ZodString>;
    note: z.ZodOptional<z.ZodString>;
    /** R2 key of the document as it stood at this version. */
    documentKey: z.ZodNullable<z.ZodString>;
    clauses: z.ZodArray<z.ZodType<Clause, z.ZodTypeDef, Clause>, "many">;
}, "strip", z.ZodTypeAny, {
    createdAt: string;
    createdBy: string | null;
    version: number;
    documentKey: string | null;
    clauses: Clause[];
    note?: string | undefined;
}, {
    createdAt: string;
    createdBy: string | null;
    version: number;
    documentKey: string | null;
    clauses: Clause[];
    note?: string | undefined;
}>;
export declare const contractSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    /** Human reference, unique per tenant, e.g. "NDA-2026-0042". */
    reference: z.ZodString;
    title: z.ZodString;
    kind: z.ZodEnum<["nda", "service_agreement", "employment", "lease", "supplier", "license", "other"]>;
    status: z.ZodEnum<["draft", "in_review", "awaiting_signature", "active", "expired", "terminated"]>;
    parties: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        role: z.ZodEnum<["first_party", "counterparty", "guarantor", "witness"]>;
        /** Links to an HR employee or a financial counterparty when one exists. */
        externalRef: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }, {
        id: string;
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }>, "many">;
    governingLaw: z.ZodNullable<z.ZodString>;
    jurisdiction: z.ZodNullable<z.ZodString>;
    effectiveFrom: z.ZodNullable<z.ZodString>;
    effectiveTo: z.ZodNullable<z.ZodString>;
    /** Days before effectiveTo at which legal.contract.expiring fires. */
    renewalNoticeDays: z.ZodDefault<z.ZodNumber>;
    autoRenew: z.ZodDefault<z.ZodBoolean>;
    value: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>>;
    risk: z.ZodNullable<z.ZodEnum<["low", "medium", "high", "critical"]>>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** Current version number; full history in `versions`. */
    currentVersion: z.ZodNumber;
    clauses: z.ZodDefault<z.ZodArray<z.ZodType<Clause, z.ZodTypeDef, Clause>, "many">>;
    obligations: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        clauseId: z.ZodString;
        description: z.ZodString;
        owner: z.ZodEnum<["us", "counterparty"]>;
        dueDate: z.ZodNullable<z.ZodString>;
        recurrence: z.ZodDefault<z.ZodEnum<["once", "monthly", "quarterly", "annually"]>>;
        amount: z.ZodNullable<z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            amountMinor: number;
            currency: string;
        }, {
            amountMinor: number;
            currency: string;
        }>>;
        fulfilled: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        dueDate: string | null;
        amount: {
            amountMinor: number;
            currency: string;
        } | null;
        description: string;
        clauseId: string;
        owner: "counterparty" | "us";
        recurrence: "once" | "monthly" | "quarterly" | "annually";
        fulfilled: boolean;
    }, {
        id: string;
        dueDate: string | null;
        amount: {
            amountMinor: number;
            currency: string;
        } | null;
        description: string;
        clauseId: string;
        owner: "counterparty" | "us";
        recurrence?: "once" | "monthly" | "quarterly" | "annually" | undefined;
        fulfilled?: boolean | undefined;
    }>, "many">>;
    documentKey: z.ZodNullable<z.ZodString>;
} & {
    createdAt: z.ZodString;
    createdBy: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
    updatedBy: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    value: {
        amountMinor: number;
        currency: string;
    } | null;
    status: "active" | "draft" | "terminated" | "in_review" | "awaiting_signature" | "expired";
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    title: string;
    id: string;
    tenantId: string;
    reference: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    documentKey: string | null;
    risk: "low" | "medium" | "high" | "critical" | null;
    tags: string[];
    clauses: Clause[];
    kind: "nda" | "service_agreement" | "employment" | "lease" | "supplier" | "license" | "other";
    parties: {
        id: string;
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }[];
    governingLaw: string | null;
    jurisdiction: string | null;
    renewalNoticeDays: number;
    autoRenew: boolean;
    currentVersion: number;
    obligations: {
        id: string;
        dueDate: string | null;
        amount: {
            amountMinor: number;
            currency: string;
        } | null;
        description: string;
        clauseId: string;
        owner: "counterparty" | "us";
        recurrence: "once" | "monthly" | "quarterly" | "annually";
        fulfilled: boolean;
    }[];
}, {
    value: {
        amountMinor: number;
        currency: string;
    } | null;
    status: "active" | "draft" | "terminated" | "in_review" | "awaiting_signature" | "expired";
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    title: string;
    id: string;
    tenantId: string;
    reference: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    documentKey: string | null;
    risk: "low" | "medium" | "high" | "critical" | null;
    kind: "nda" | "service_agreement" | "employment" | "lease" | "supplier" | "license" | "other";
    parties: {
        id: string;
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }[];
    governingLaw: string | null;
    jurisdiction: string | null;
    currentVersion: number;
    tags?: string[] | undefined;
    clauses?: Clause[] | undefined;
    renewalNoticeDays?: number | undefined;
    autoRenew?: boolean | undefined;
    obligations?: {
        id: string;
        dueDate: string | null;
        amount: {
            amountMinor: number;
            currency: string;
        } | null;
        description: string;
        clauseId: string;
        owner: "counterparty" | "us";
        recurrence?: "once" | "monthly" | "quarterly" | "annually" | undefined;
        fulfilled?: boolean | undefined;
    }[] | undefined;
}>;
export type Contract = z.infer<typeof contractSchema>;
export declare const createContractSchema: z.ZodObject<{
    title: z.ZodString;
    kind: z.ZodEnum<["nda", "service_agreement", "employment", "lease", "supplier", "license", "other"]>;
    parties: z.ZodArray<z.ZodObject<Omit<{
        id: z.ZodString;
        name: z.ZodString;
        role: z.ZodEnum<["first_party", "counterparty", "guarantor", "witness"]>;
        /** Links to an HR employee or a financial counterparty when one exists. */
        externalRef: z.ZodNullable<z.ZodString>;
    }, "id">, "strip", z.ZodTypeAny, {
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }, {
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }>, "many">;
    governingLaw: z.ZodOptional<z.ZodString>;
    jurisdiction: z.ZodOptional<z.ZodString>;
    effectiveFrom: z.ZodOptional<z.ZodString>;
    effectiveTo: z.ZodOptional<z.ZodString>;
    renewalNoticeDays: z.ZodOptional<z.ZodNumber>;
    autoRenew: z.ZodOptional<z.ZodBoolean>;
    value: z.ZodOptional<z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    title: string;
    kind: "nda" | "service_agreement" | "employment" | "lease" | "supplier" | "license" | "other";
    parties: {
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }[];
    value?: {
        amountMinor: number;
        currency: string;
    } | undefined;
    effectiveFrom?: string | undefined;
    effectiveTo?: string | undefined;
    tags?: string[] | undefined;
    governingLaw?: string | undefined;
    jurisdiction?: string | undefined;
    renewalNoticeDays?: number | undefined;
    autoRenew?: boolean | undefined;
}, {
    title: string;
    kind: "nda" | "service_agreement" | "employment" | "lease" | "supplier" | "license" | "other";
    parties: {
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }[];
    value?: {
        amountMinor: number;
        currency: string;
    } | undefined;
    effectiveFrom?: string | undefined;
    effectiveTo?: string | undefined;
    tags?: string[] | undefined;
    governingLaw?: string | undefined;
    jurisdiction?: string | undefined;
    renewalNoticeDays?: number | undefined;
    autoRenew?: boolean | undefined;
}>;
export type CreateContract = z.infer<typeof createContractSchema>;
export declare const updateContractSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodEnum<["nda", "service_agreement", "employment", "lease", "supplier", "license", "other"]>>;
    parties: z.ZodOptional<z.ZodArray<z.ZodObject<Omit<{
        id: z.ZodString;
        name: z.ZodString;
        role: z.ZodEnum<["first_party", "counterparty", "guarantor", "witness"]>;
        /** Links to an HR employee or a financial counterparty when one exists. */
        externalRef: z.ZodNullable<z.ZodString>;
    }, "id">, "strip", z.ZodTypeAny, {
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }, {
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }>, "many">>;
    governingLaw: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    jurisdiction: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    effectiveFrom: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    effectiveTo: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    renewalNoticeDays: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    autoRenew: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    value: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>>>;
    tags: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
}, "strip", z.ZodTypeAny, {
    value?: {
        amountMinor: number;
        currency: string;
    } | undefined;
    title?: string | undefined;
    effectiveFrom?: string | undefined;
    effectiveTo?: string | undefined;
    tags?: string[] | undefined;
    kind?: "nda" | "service_agreement" | "employment" | "lease" | "supplier" | "license" | "other" | undefined;
    parties?: {
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }[] | undefined;
    governingLaw?: string | undefined;
    jurisdiction?: string | undefined;
    renewalNoticeDays?: number | undefined;
    autoRenew?: boolean | undefined;
}, {
    value?: {
        amountMinor: number;
        currency: string;
    } | undefined;
    title?: string | undefined;
    effectiveFrom?: string | undefined;
    effectiveTo?: string | undefined;
    tags?: string[] | undefined;
    kind?: "nda" | "service_agreement" | "employment" | "lease" | "supplier" | "license" | "other" | undefined;
    parties?: {
        name: string;
        role: "first_party" | "counterparty" | "guarantor" | "witness";
        externalRef: string | null;
    }[] | undefined;
    governingLaw?: string | undefined;
    jurisdiction?: string | undefined;
    renewalNoticeDays?: number | undefined;
    autoRenew?: boolean | undefined;
}>;
export type UpdateContract = z.infer<typeof updateContractSchema>;
export declare const contractFilterSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["draft", "in_review", "awaiting_signature", "active", "expired", "terminated"]>>;
    kind: z.ZodOptional<z.ZodEnum<["nda", "service_agreement", "employment", "lease", "supplier", "license", "other"]>>;
    risk: z.ZodOptional<z.ZodEnum<["low", "medium", "high", "critical"]>>;
    expiringWithinDays: z.ZodOptional<z.ZodNumber>;
    tag: z.ZodOptional<z.ZodString>;
    q: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status?: "active" | "draft" | "terminated" | "in_review" | "awaiting_signature" | "expired" | undefined;
    q?: string | undefined;
    risk?: "low" | "medium" | "high" | "critical" | undefined;
    kind?: "nda" | "service_agreement" | "employment" | "lease" | "supplier" | "license" | "other" | undefined;
    expiringWithinDays?: number | undefined;
    tag?: string | undefined;
}, {
    status?: "active" | "draft" | "terminated" | "in_review" | "awaiting_signature" | "expired" | undefined;
    q?: string | undefined;
    risk?: "low" | "medium" | "high" | "critical" | undefined;
    kind?: "nda" | "service_agreement" | "employment" | "lease" | "supplier" | "license" | "other" | undefined;
    expiringWithinDays?: number | undefined;
    tag?: string | undefined;
}>;
export type ContractFilter = z.infer<typeof contractFilterSchema>;
/** Presigned upload/download ticket issued by legal-svc for R2. */
export declare const documentTicketSchema: z.ZodObject<{
    url: z.ZodString;
    key: z.ZodString;
    expiresAt: z.ZodString;
    method: z.ZodEnum<["GET", "PUT"]>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    url: string;
    key: string;
    expiresAt: string;
    method: "GET" | "PUT";
    headers?: Record<string, string> | undefined;
}, {
    url: string;
    key: string;
    expiresAt: string;
    method: "GET" | "PUT";
    headers?: Record<string, string> | undefined;
}>;
export type DocumentTicket = z.infer<typeof documentTicketSchema>;
//# sourceMappingURL=contract.d.ts.map