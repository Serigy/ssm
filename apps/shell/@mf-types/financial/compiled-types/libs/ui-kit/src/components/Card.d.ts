import type { HTMLAttributes, ReactNode } from 'react';
interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    eyebrow?: ReactNode;
    title?: ReactNode;
    footer?: ReactNode;
    interactive?: boolean;
    tone?: 'default' | 'sunken' | 'inverse';
    children?: ReactNode;
}
export declare function Card({ eyebrow, title, footer, interactive, tone, className, children, ...rest }: CardProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Card.d.ts.map