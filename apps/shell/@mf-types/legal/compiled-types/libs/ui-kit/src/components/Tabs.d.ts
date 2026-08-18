import { type ReactNode } from 'react';
export interface TabItem {
    value: string;
    label: ReactNode;
    count?: number;
}
interface TabsProps {
    items: TabItem[];
    value?: string;
    onChange?: (value: string) => void;
    className?: string;
    'aria-label'?: string;
}
/** Controlled when `value` is supplied, uncontrolled otherwise. */
export declare function Tabs({ items, value, onChange, className, ...rest }: TabsProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Tabs.d.ts.map