import { type ReactNode, type SelectHTMLAttributes } from 'react';
import type { ControlSize } from './Button.js';
export type SelectOption = {
    value: string;
    label: string;
} | string;
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    size?: ControlSize;
    options: SelectOption[];
    /** Leading blank option, e.g. "Todos os estados". */
    placeholder?: string;
}
export declare function Select({ label, hint, error, required, size, options, placeholder, id, className, ...rest }: SelectProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Select.d.ts.map