import type { HTMLAttributes, ReactNode } from 'react';
export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    tone?: BadgeTone;
    dot?: boolean;
    children: ReactNode;
}
/**
 * `accent` is coral, which the design system reserves for marketing surfaces.
 * It has no legitimate use inside a module's product UI.
 */
export declare function Badge({ tone, dot, className, children, ...rest }: BadgeProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Badge.d.ts.map