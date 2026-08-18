import type { CreateInvoice, Invoice, InvoiceFilter, Page, RecordPayment } from '@ssm/contracts';
import type { ApiClient } from '@ssm/mfe-runtime';
/**
 * Every call this module makes, in one file.
 *
 * Screens never build a URL themselves: when the gateway route or the API
 * version changes, this is the only file that moves.
 */
export declare const financialApi: {
    readonly list: (api: ApiClient, filter: InvoiceFilter & {
        limit?: number;
        cursor?: string;
    }) => Promise<Page<{
        number: string | null;
        status: "void" | "draft" | "issued" | "partially_paid" | "paid";
        currency: string;
        createdAt: string;
        createdBy: string | null;
        updatedAt: string;
        updatedBy: string | null;
        total: {
            amountMinor: number;
            currency: string;
        };
        id: string;
        tenantId: string;
        counterpartyId: string;
        dueDate: string;
        counterpartyName: string;
        issueDate: string | null;
        lines: {
            id: string;
            description: string;
            quantityMilli: number;
            unitPrice: {
                amountMinor: number;
                currency: string;
            };
            taxRateBps: number;
            lineTotal: {
                amountMinor: number;
                currency: string;
            };
        }[];
        subtotal: {
            amountMinor: number;
            currency: string;
        };
        taxTotal: {
            amountMinor: number;
            currency: string;
        };
        amountPaid: {
            amountMinor: number;
            currency: string;
        };
        documentKey: string | null;
        notes?: string | undefined;
    }>>;
    readonly get: (api: ApiClient, id: string) => Promise<{
        number: string | null;
        status: "void" | "draft" | "issued" | "partially_paid" | "paid";
        currency: string;
        createdAt: string;
        createdBy: string | null;
        updatedAt: string;
        updatedBy: string | null;
        total: {
            amountMinor: number;
            currency: string;
        };
        id: string;
        tenantId: string;
        counterpartyId: string;
        dueDate: string;
        counterpartyName: string;
        issueDate: string | null;
        lines: {
            id: string;
            description: string;
            quantityMilli: number;
            unitPrice: {
                amountMinor: number;
                currency: string;
            };
            taxRateBps: number;
            lineTotal: {
                amountMinor: number;
                currency: string;
            };
        }[];
        subtotal: {
            amountMinor: number;
            currency: string;
        };
        taxTotal: {
            amountMinor: number;
            currency: string;
        };
        amountPaid: {
            amountMinor: number;
            currency: string;
        };
        documentKey: string | null;
        notes?: string | undefined;
    }>;
    readonly create: (api: ApiClient, dto: CreateInvoice) => Promise<{
        number: string | null;
        status: "void" | "draft" | "issued" | "partially_paid" | "paid";
        currency: string;
        createdAt: string;
        createdBy: string | null;
        updatedAt: string;
        updatedBy: string | null;
        total: {
            amountMinor: number;
            currency: string;
        };
        id: string;
        tenantId: string;
        counterpartyId: string;
        dueDate: string;
        counterpartyName: string;
        issueDate: string | null;
        lines: {
            id: string;
            description: string;
            quantityMilli: number;
            unitPrice: {
                amountMinor: number;
                currency: string;
            };
            taxRateBps: number;
            lineTotal: {
                amountMinor: number;
                currency: string;
            };
        }[];
        subtotal: {
            amountMinor: number;
            currency: string;
        };
        taxTotal: {
            amountMinor: number;
            currency: string;
        };
        amountPaid: {
            amountMinor: number;
            currency: string;
        };
        documentKey: string | null;
        notes?: string | undefined;
    }>;
    readonly issue: (api: ApiClient, id: string) => Promise<{
        number: string | null;
        status: "void" | "draft" | "issued" | "partially_paid" | "paid";
        currency: string;
        createdAt: string;
        createdBy: string | null;
        updatedAt: string;
        updatedBy: string | null;
        total: {
            amountMinor: number;
            currency: string;
        };
        id: string;
        tenantId: string;
        counterpartyId: string;
        dueDate: string;
        counterpartyName: string;
        issueDate: string | null;
        lines: {
            id: string;
            description: string;
            quantityMilli: number;
            unitPrice: {
                amountMinor: number;
                currency: string;
            };
            taxRateBps: number;
            lineTotal: {
                amountMinor: number;
                currency: string;
            };
        }[];
        subtotal: {
            amountMinor: number;
            currency: string;
        };
        taxTotal: {
            amountMinor: number;
            currency: string;
        };
        amountPaid: {
            amountMinor: number;
            currency: string;
        };
        documentKey: string | null;
        notes?: string | undefined;
    }>;
    readonly recordPayment: (api: ApiClient, id: string, dto: RecordPayment) => Promise<{
        number: string | null;
        status: "void" | "draft" | "issued" | "partially_paid" | "paid";
        currency: string;
        createdAt: string;
        createdBy: string | null;
        updatedAt: string;
        updatedBy: string | null;
        total: {
            amountMinor: number;
            currency: string;
        };
        id: string;
        tenantId: string;
        counterpartyId: string;
        dueDate: string;
        counterpartyName: string;
        issueDate: string | null;
        lines: {
            id: string;
            description: string;
            quantityMilli: number;
            unitPrice: {
                amountMinor: number;
                currency: string;
            };
            taxRateBps: number;
            lineTotal: {
                amountMinor: number;
                currency: string;
            };
        }[];
        subtotal: {
            amountMinor: number;
            currency: string;
        };
        taxTotal: {
            amountMinor: number;
            currency: string;
        };
        amountPaid: {
            amountMinor: number;
            currency: string;
        };
        documentKey: string | null;
        notes?: string | undefined;
    }>;
    readonly void: (api: ApiClient, id: string, reason: string) => Promise<{
        number: string | null;
        status: "void" | "draft" | "issued" | "partially_paid" | "paid";
        currency: string;
        createdAt: string;
        createdBy: string | null;
        updatedAt: string;
        updatedBy: string | null;
        total: {
            amountMinor: number;
            currency: string;
        };
        id: string;
        tenantId: string;
        counterpartyId: string;
        dueDate: string;
        counterpartyName: string;
        issueDate: string | null;
        lines: {
            id: string;
            description: string;
            quantityMilli: number;
            unitPrice: {
                amountMinor: number;
                currency: string;
            };
            taxRateBps: number;
            lineTotal: {
                amountMinor: number;
                currency: string;
            };
        }[];
        subtotal: {
            amountMinor: number;
            currency: string;
        };
        taxTotal: {
            amountMinor: number;
            currency: string;
        };
        amountPaid: {
            amountMinor: number;
            currency: string;
        };
        documentKey: string | null;
        notes?: string | undefined;
    }>;
    readonly remove: (api: ApiClient, id: string) => Promise<void>;
    readonly documentUrl: (api: ApiClient, id: string) => Promise<{
        url: string;
    }>;
};
export type InvoicePage = Page<Invoice>;
//# sourceMappingURL=api.d.ts.map