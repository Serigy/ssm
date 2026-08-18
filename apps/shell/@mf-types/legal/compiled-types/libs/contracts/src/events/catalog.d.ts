import { z } from 'zod';
/**
 * The event catalog. `docs/architecture/events.md` is generated from this file,
 * so adding an event here is what makes it real and documented.
 */
export declare const invoiceIssuedSchema: z.ZodObject<{
    invoiceId: z.ZodString;
    number: z.ZodString;
    counterpartyId: z.ZodString;
    total: z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>;
    dueDate: z.ZodString;
}, "strip", z.ZodTypeAny, {
    number: string;
    total: {
        amountMinor: number;
        currency: string;
    };
    invoiceId: string;
    counterpartyId: string;
    dueDate: string;
}, {
    number: string;
    total: {
        amountMinor: number;
        currency: string;
    };
    invoiceId: string;
    counterpartyId: string;
    dueDate: string;
}>;
export declare const invoicePaidSchema: z.ZodObject<{
    invoiceId: z.ZodString;
    paidAt: z.ZodString;
    amount: z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>;
}, "strip", z.ZodTypeAny, {
    invoiceId: string;
    paidAt: string;
    amount: {
        amountMinor: number;
        currency: string;
    };
}, {
    invoiceId: string;
    paidAt: string;
    amount: {
        amountMinor: number;
        currency: string;
    };
}>;
export declare const invoiceVoidedSchema: z.ZodObject<{
    invoiceId: z.ZodString;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    invoiceId: string;
    reason: string;
}, {
    invoiceId: string;
    reason: string;
}>;
export declare const employeeHiredSchema: z.ZodObject<{
    employeeId: z.ZodString;
    personName: z.ZodString;
    departmentId: z.ZodNullable<z.ZodString>;
    startDate: z.ZodString;
}, "strip", z.ZodTypeAny, {
    employeeId: string;
    personName: string;
    departmentId: string | null;
    startDate: string;
}, {
    employeeId: string;
    personName: string;
    departmentId: string | null;
    startDate: string;
}>;
export declare const employeeOffboardedSchema: z.ZodObject<{
    employeeId: z.ZodString;
    lastDay: z.ZodString;
    reason: z.ZodEnum<["resignation", "termination", "end_of_contract", "retirement"]>;
}, "strip", z.ZodTypeAny, {
    reason: "resignation" | "termination" | "end_of_contract" | "retirement";
    employeeId: string;
    lastDay: string;
}, {
    reason: "resignation" | "termination" | "end_of_contract" | "retirement";
    employeeId: string;
    lastDay: string;
}>;
export declare const contractActivatedSchema: z.ZodObject<{
    contractId: z.ZodString;
    reference: z.ZodString;
    counterpartyId: z.ZodString;
    effectiveFrom: z.ZodString;
    effectiveTo: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    counterpartyId: string;
    contractId: string;
    reference: string;
    effectiveFrom: string;
    effectiveTo: string | null;
}, {
    counterpartyId: string;
    contractId: string;
    reference: string;
    effectiveFrom: string;
    effectiveTo: string | null;
}>;
export declare const contractExpiringSchema: z.ZodObject<{
    contractId: z.ZodString;
    reference: z.ZodString;
    expiresOn: z.ZodString;
    daysRemaining: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    contractId: string;
    reference: string;
    expiresOn: string;
    daysRemaining: number;
}, {
    contractId: string;
    reference: string;
    expiresOn: string;
    daysRemaining: number;
}>;
export declare const EVENT_CATALOG: {
    readonly 'financial.invoice.issued': z.ZodObject<{
        invoiceId: z.ZodString;
        number: z.ZodString;
        counterpartyId: z.ZodString;
        total: z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            amountMinor: number;
            currency: string;
        }, {
            amountMinor: number;
            currency: string;
        }>;
        dueDate: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        number: string;
        total: {
            amountMinor: number;
            currency: string;
        };
        invoiceId: string;
        counterpartyId: string;
        dueDate: string;
    }, {
        number: string;
        total: {
            amountMinor: number;
            currency: string;
        };
        invoiceId: string;
        counterpartyId: string;
        dueDate: string;
    }>;
    readonly 'financial.invoice.paid': z.ZodObject<{
        invoiceId: z.ZodString;
        paidAt: z.ZodString;
        amount: z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            amountMinor: number;
            currency: string;
        }, {
            amountMinor: number;
            currency: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        invoiceId: string;
        paidAt: string;
        amount: {
            amountMinor: number;
            currency: string;
        };
    }, {
        invoiceId: string;
        paidAt: string;
        amount: {
            amountMinor: number;
            currency: string;
        };
    }>;
    readonly 'financial.invoice.voided': z.ZodObject<{
        invoiceId: z.ZodString;
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        invoiceId: string;
        reason: string;
    }, {
        invoiceId: string;
        reason: string;
    }>;
    readonly 'hr.employee.hired': z.ZodObject<{
        employeeId: z.ZodString;
        personName: z.ZodString;
        departmentId: z.ZodNullable<z.ZodString>;
        startDate: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        employeeId: string;
        personName: string;
        departmentId: string | null;
        startDate: string;
    }, {
        employeeId: string;
        personName: string;
        departmentId: string | null;
        startDate: string;
    }>;
    readonly 'hr.employee.offboarded': z.ZodObject<{
        employeeId: z.ZodString;
        lastDay: z.ZodString;
        reason: z.ZodEnum<["resignation", "termination", "end_of_contract", "retirement"]>;
    }, "strip", z.ZodTypeAny, {
        reason: "resignation" | "termination" | "end_of_contract" | "retirement";
        employeeId: string;
        lastDay: string;
    }, {
        reason: "resignation" | "termination" | "end_of_contract" | "retirement";
        employeeId: string;
        lastDay: string;
    }>;
    readonly 'legal.contract.activated': z.ZodObject<{
        contractId: z.ZodString;
        reference: z.ZodString;
        counterpartyId: z.ZodString;
        effectiveFrom: z.ZodString;
        effectiveTo: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        counterpartyId: string;
        contractId: string;
        reference: string;
        effectiveFrom: string;
        effectiveTo: string | null;
    }, {
        counterpartyId: string;
        contractId: string;
        reference: string;
        effectiveFrom: string;
        effectiveTo: string | null;
    }>;
    readonly 'legal.contract.expiring': z.ZodObject<{
        contractId: z.ZodString;
        reference: z.ZodString;
        expiresOn: z.ZodString;
        daysRemaining: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        contractId: string;
        reference: string;
        expiresOn: string;
        daysRemaining: number;
    }, {
        contractId: string;
        reference: string;
        expiresOn: string;
        daysRemaining: number;
    }>;
};
export type EventType = keyof typeof EVENT_CATALOG;
export type EventPayload<T extends EventType> = z.infer<(typeof EVENT_CATALOG)[T]>;
/** Runtime guard used by consumers before they touch `data`. */
export declare function parseEventPayload<T extends EventType>(type: T, data: unknown): EventPayload<T>;
//# sourceMappingURL=catalog.d.ts.map