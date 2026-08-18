import type { InvoiceStatus } from '@ssm/contracts';
import type { BadgeTone } from '@ssm/ui-kit';
/**
 * One mapping from domain state to presentation, used by the list, the detail
 * screen and anything added later — so a status never renders as "warning" in
 * one place and "danger" in another.
 */
export declare const STATUS_LABEL: Record<InvoiceStatus, string>;
export declare const STATUS_TONE: Record<InvoiceStatus, BadgeTone>;
/** True when the due date has passed and the balance is still open. */
export declare function isOverdue(dueDate: string, status: InvoiceStatus): boolean;
//# sourceMappingURL=status.d.ts.map