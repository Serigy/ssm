import { z } from 'zod';
/**
 * Invoice lifecycle. Transitions are enforced in the domain layer of
 * financial-svc — see docs/modules/financial.md for the state machine.
 *
 *   draft ──issue──> issued ──pay──> paid
 *     │                 │
 *     └──void──> void <─┘
 */
export declare const invoiceStatusSchema: z.ZodEnum<["draft", "issued", "partially_paid", "paid", "void"]>;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export declare const invoiceLineSchema: z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    /** Quantity in thousandths, to keep integer arithmetic end to end (1.5 -> 1500). */
    quantityMilli: z.ZodNumber;
    unitPrice: z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>;
    /** Basis points: 2100 == 21%. */
    taxRateBps: z.ZodDefault<z.ZodNumber>;
    lineTotal: z.ZodObject<{
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
}, {
    id: string;
    description: string;
    quantityMilli: number;
    unitPrice: {
        amountMinor: number;
        currency: string;
    };
    lineTotal: {
        amountMinor: number;
        currency: string;
    };
    taxRateBps?: number | undefined;
}>;
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;
export declare const invoiceSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    /** Human-facing sequential number, assigned at issue time. Null while draft. */
    number: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<["draft", "issued", "partially_paid", "paid", "void"]>;
    counterpartyId: z.ZodString;
    counterpartyName: z.ZodString;
    issueDate: z.ZodNullable<z.ZodString>;
    dueDate: z.ZodString;
    currency: z.ZodString;
    lines: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        description: z.ZodString;
        /** Quantity in thousandths, to keep integer arithmetic end to end (1.5 -> 1500). */
        quantityMilli: z.ZodNumber;
        unitPrice: z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            amountMinor: number;
            currency: string;
        }, {
            amountMinor: number;
            currency: string;
        }>;
        /** Basis points: 2100 == 21%. */
        taxRateBps: z.ZodDefault<z.ZodNumber>;
        lineTotal: z.ZodObject<{
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
    }, {
        id: string;
        description: string;
        quantityMilli: number;
        unitPrice: {
            amountMinor: number;
            currency: string;
        };
        lineTotal: {
            amountMinor: number;
            currency: string;
        };
        taxRateBps?: number | undefined;
    }>, "many">;
    subtotal: z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>;
    taxTotal: z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>;
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
    amountPaid: z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        amountMinor: number;
        currency: string;
    }, {
        amountMinor: number;
        currency: string;
    }>;
    notes: z.ZodOptional<z.ZodString>;
    /** Key of the rendered PDF in the R2 documents bucket. */
    documentKey: z.ZodNullable<z.ZodString>;
} & {
    createdAt: z.ZodString;
    createdBy: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
    updatedBy: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
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
}, {
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
        lineTotal: {
            amountMinor: number;
            currency: string;
        };
        taxRateBps?: number | undefined;
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
export type Invoice = z.infer<typeof invoiceSchema>;
export declare const createInvoiceSchema: z.ZodObject<{
    counterpartyId: z.ZodString;
    counterpartyName: z.ZodString;
    dueDate: z.ZodString;
    currency: z.ZodString;
    notes: z.ZodOptional<z.ZodString>;
    lines: z.ZodArray<z.ZodObject<Pick<{
        id: z.ZodString;
        description: z.ZodString;
        /** Quantity in thousandths, to keep integer arithmetic end to end (1.5 -> 1500). */
        quantityMilli: z.ZodNumber;
        unitPrice: z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            amountMinor: number;
            currency: string;
        }, {
            amountMinor: number;
            currency: string;
        }>;
        /** Basis points: 2100 == 21%. */
        taxRateBps: z.ZodDefault<z.ZodNumber>;
        lineTotal: z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            amountMinor: number;
            currency: string;
        }, {
            amountMinor: number;
            currency: string;
        }>;
    }, "description" | "quantityMilli" | "unitPrice" | "taxRateBps">, "strip", z.ZodTypeAny, {
        description: string;
        quantityMilli: number;
        unitPrice: {
            amountMinor: number;
            currency: string;
        };
        taxRateBps: number;
    }, {
        description: string;
        quantityMilli: number;
        unitPrice: {
            amountMinor: number;
            currency: string;
        };
        taxRateBps?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    currency: string;
    counterpartyId: string;
    dueDate: string;
    counterpartyName: string;
    lines: {
        description: string;
        quantityMilli: number;
        unitPrice: {
            amountMinor: number;
            currency: string;
        };
        taxRateBps: number;
    }[];
    notes?: string | undefined;
}, {
    currency: string;
    counterpartyId: string;
    dueDate: string;
    counterpartyName: string;
    lines: {
        description: string;
        quantityMilli: number;
        unitPrice: {
            amountMinor: number;
            currency: string;
        };
        taxRateBps?: number | undefined;
    }[];
    notes?: string | undefined;
}>;
export type CreateInvoice = z.infer<typeof createInvoiceSchema>;
export declare const updateInvoiceSchema: z.ZodObject<{
    counterpartyId: z.ZodOptional<z.ZodString>;
    counterpartyName: z.ZodOptional<z.ZodString>;
    dueDate: z.ZodOptional<z.ZodString>;
    currency: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    lines: z.ZodOptional<z.ZodArray<z.ZodObject<Pick<{
        id: z.ZodString;
        description: z.ZodString;
        /** Quantity in thousandths, to keep integer arithmetic end to end (1.5 -> 1500). */
        quantityMilli: z.ZodNumber;
        unitPrice: z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            amountMinor: number;
            currency: string;
        }, {
            amountMinor: number;
            currency: string;
        }>;
        /** Basis points: 2100 == 21%. */
        taxRateBps: z.ZodDefault<z.ZodNumber>;
        lineTotal: z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            amountMinor: number;
            currency: string;
        }, {
            amountMinor: number;
            currency: string;
        }>;
    }, "description" | "quantityMilli" | "unitPrice" | "taxRateBps">, "strip", z.ZodTypeAny, {
        description: string;
        quantityMilli: number;
        unitPrice: {
            amountMinor: number;
            currency: string;
        };
        taxRateBps: number;
    }, {
        description: string;
        quantityMilli: number;
        unitPrice: {
            amountMinor: number;
            currency: string;
        };
        taxRateBps?: number | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    currency?: string | undefined;
    counterpartyId?: string | undefined;
    dueDate?: string | undefined;
    counterpartyName?: string | undefined;
    lines?: {
        description: string;
        quantityMilli: number;
        unitPrice: {
            amountMinor: number;
            currency: string;
        };
        taxRateBps: number;
    }[] | undefined;
    notes?: string | undefined;
}, {
    currency?: string | undefined;
    counterpartyId?: string | undefined;
    dueDate?: string | undefined;
    counterpartyName?: string | undefined;
    lines?: {
        description: string;
        quantityMilli: number;
        unitPrice: {
            amountMinor: number;
            currency: string;
        };
        taxRateBps?: number | undefined;
    }[] | undefined;
    notes?: string | undefined;
}>;
export type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;
export declare const recordPaymentSchema: z.ZodObject<{
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
    paidAt: z.ZodString;
    reference: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    paidAt: string;
    amount: {
        amountMinor: number;
        currency: string;
    };
    reference?: string | undefined;
}, {
    paidAt: string;
    amount: {
        amountMinor: number;
        currency: string;
    };
    reference?: string | undefined;
}>;
export type RecordPayment = z.infer<typeof recordPaymentSchema>;
export declare const invoiceFilterSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["draft", "issued", "partially_paid", "paid", "void"]>>;
    counterpartyId: z.ZodOptional<z.ZodString>;
    dueBefore: z.ZodOptional<z.ZodString>;
    dueAfter: z.ZodOptional<z.ZodString>;
    q: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status?: "void" | "draft" | "issued" | "partially_paid" | "paid" | undefined;
    counterpartyId?: string | undefined;
    dueBefore?: string | undefined;
    dueAfter?: string | undefined;
    q?: string | undefined;
}, {
    status?: "void" | "draft" | "issued" | "partially_paid" | "paid" | undefined;
    counterpartyId?: string | undefined;
    dueBefore?: string | undefined;
    dueAfter?: string | undefined;
    q?: string | undefined;
}>;
export type InvoiceFilter = z.infer<typeof invoiceFilterSchema>;
//# sourceMappingURL=invoice.d.ts.map