import { type InputHTMLAttributes, type ReactNode } from 'react';
interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    label?: ReactNode;
}
export declare function Switch({ label, id, className, disabled, ...rest }: SwitchProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Switch.d.ts.map