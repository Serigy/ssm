import { type ReactNode } from 'react';
interface DialogProps {
    open: boolean;
    title: ReactNode;
    description?: ReactNode;
    footer?: ReactNode;
    onClose?: () => void;
    width?: number;
    children?: ReactNode;
}
/**
 * Modal dialog. Adds three things the prototype could not: Escape to close,
 * focus moved into the dialog on open and restored on close, and a focus trap.
 * Without them a keyboard user can tab out of a modal into the page behind it.
 */
export declare function Dialog({ open, title, description, footer, onClose, width, children, }: DialogProps): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=Dialog.d.ts.map