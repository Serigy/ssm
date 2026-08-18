import type { CSSProperties, ReactNode } from 'react';
export interface FieldProps {
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    required?: boolean;
    htmlFor?: string;
    className?: string;
    style?: CSSProperties;
    children: ReactNode;
}
/** Shared label/hint/error envelope, so no control re-invents the structure. */
export declare function Field({ label, hint, error, required, htmlFor, className, style, children }: FieldProps): import("react").JSX.Element;
//# sourceMappingURL=Field.d.ts.map