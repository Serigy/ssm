import type { ContractStatus } from '@ssm/contracts';
import type { BadgeTone } from '@ssm/ui-kit';
export declare const STATUS_LABEL: Record<ContractStatus, string>;
export declare const STATUS_TONE: Record<ContractStatus, BadgeTone>;
export declare const KIND_LABEL: Record<string, string>;
export declare const RISK_LABEL: Record<string, string>;
export declare const RISK_TONE: Record<string, BadgeTone>;
/** Days until the contract's end date; null when it has none. */
export declare function daysUntil(effectiveTo: string | null): number | null;
//# sourceMappingURL=status.d.ts.map