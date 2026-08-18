import type { ReactNode } from 'react';
interface EmptyStateProps {
    title: string;
    /** Says what happened and what to do next — never blames the user. */
    body?: string;
    action?: ReactNode;
}
export declare function EmptyState({ title, body, action }: EmptyStateProps): import("react").JSX.Element;
/** The 2px bar is the only looping animation the design system allows. */
export declare function LoadingBar(): import("react").JSX.Element;
export declare function Skeleton({ height, width }: {
    height?: number;
    width?: string;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=EmptyState.d.ts.map