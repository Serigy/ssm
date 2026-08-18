import { type ReactNode } from 'react';
export interface NavItem {
    id: string;
    label: string;
    href: string;
    /** Optional grouping header rendered above the item. */
    group?: string;
}
interface AppShellProps {
    /** Rendered under the SERIGY wordmark, mono uppercase. */
    product: string;
    nav: NavItem[];
    activeId: string;
    onNavigate: (item: NavItem) => void;
    title: ReactNode;
    subtitle?: ReactNode;
    actions?: ReactNode;
    user?: {
        name: string;
        email: string;
    };
    footLabel?: string;
    footValue?: string;
    children: ReactNode;
}
/**
 * The host shell's chrome. Lives in the UI kit rather than in apps/shell so a
 * micro-frontend can render the same chrome when it runs standalone in
 * development — otherwise a remote developed in isolation looks nothing like
 * the assembled application.
 *
 * There is no logo file: the design system specifies the wordmark SERIGY set
 * in Archivo 800, uppercase, tracking-wide.
 */
export declare function AppShell({ product, nav, activeId, onNavigate, title, subtitle, actions, user, footLabel, footValue, children, }: AppShellProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=AppShell.d.ts.map