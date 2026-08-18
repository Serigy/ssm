import { type InputHTMLAttributes, type ReactNode } from 'react';
interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    label: ReactNode;
    hint?: ReactNode;
}
export declare function Radio({ label, hint, id, className, disabled, ...rest }: RadioProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Radio.d.ts.map