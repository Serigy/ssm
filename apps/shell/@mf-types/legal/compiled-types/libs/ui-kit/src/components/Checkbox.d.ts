import { type InputHTMLAttributes, type ReactNode } from 'react';
interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    label: ReactNode;
    hint?: ReactNode;
}
export declare function Checkbox({ label, hint, id, className, disabled, ...rest }: CheckboxProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Checkbox.d.ts.map