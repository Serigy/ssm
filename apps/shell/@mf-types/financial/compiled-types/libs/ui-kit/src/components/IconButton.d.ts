import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { ControlSize } from './Button.js';
interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
    /** Required: an icon alone is unreadable without it. */
    label: string;
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: ControlSize;
    children: ReactNode;
}
export declare function IconButton({ label, variant, size, className, children, ...rest }: IconButtonProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=IconButton.d.ts.map