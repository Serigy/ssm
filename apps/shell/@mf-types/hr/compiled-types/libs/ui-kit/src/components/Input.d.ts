import { type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import type { ControlSize } from './Button.js';
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    size?: ControlSize;
    icon?: ReactNode;
    /** Right-hand adornment: a unit, a currency code, a clear button. */
    suffix?: ReactNode;
    className?: string;
    /** Applied to the Field wrapper — use for sizing, e.g. { minWidth: 280 }. */
    wrapperStyle?: CSSProperties;
}
export declare function Input({ label, hint, error, required, size, icon, suffix, id, className, wrapperStyle, disabled, ...rest }: InputProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Input.d.ts.map