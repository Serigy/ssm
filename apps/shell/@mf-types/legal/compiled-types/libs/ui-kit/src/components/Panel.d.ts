import type { ReactNode } from 'react';
interface PanelProps {
    title: ReactNode;
    action?: ReactNode;
    /** Set false when the body is a table, which brings its own padding. */
    padded?: boolean;
    className?: string;
    children: ReactNode;
}
export declare function Panel({ title, action, padded, className, children }: PanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Panel.d.ts.map