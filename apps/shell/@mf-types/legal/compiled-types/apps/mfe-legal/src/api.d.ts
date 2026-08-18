import type { Contract, ContractFilter, ContractStatus, CreateContract, Page } from '@ssm/contracts';
import type { ApiClient } from '@ssm/mfe-runtime';
export declare const legalApi: {
    readonly list: (api: ApiClient, filter: ContractFilter & {
        limit?: number;
        cursor?: string;
    }) => Promise<Page<{
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
        clauses: import("@ssm/contracts").Clause[];
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
    }>>;
    readonly get: (api: ApiClient, id: string) => Promise<{
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
        clauses: import("@ssm/contracts").Clause[];
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
    }>;
    readonly create: (api: ApiClient, dto: CreateContract) => Promise<{
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
        clauses: import("@ssm/contracts").Clause[];
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
    }>;
    readonly transition: (api: ApiClient, id: string, status: ContractStatus) => Promise<{
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
        clauses: import("@ssm/contracts").Clause[];
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
    }>;
    readonly expiring: (api: ApiClient, withinDays?: number) => Promise<{
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
        clauses: import("@ssm/contracts").Clause[];
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
    }[]>;
    readonly documentUrl: (api: ApiClient, id: string) => Promise<{
        url: string;
        key: string;
        expiresAt: string;
        method: "GET" | "PUT";
        headers?: Record<string, string> | undefined;
    }>;
    /**
     * Two-step upload: ask for a presigned PUT, send the file straight to R2,
     * then tell the API the key is in place. The binary never touches the service.
     */
    readonly upload: (api: ApiClient, id: string, file: File) => Promise<Contract>;
};
export type ContractPage = Page<Contract>;
//# sourceMappingURL=api.d.ts.map