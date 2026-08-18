import { type ReactNode } from 'react';
export type ToastTone = 'info' | 'success' | 'warning' | 'danger';
export interface ToastSpec {
    id: string;
    tone: ToastTone;
    title: string;
    body?: string;
}
interface ToastProps {
    tone?: ToastTone;
    title?: ReactNode;
    onClose?: () => void;
    children?: ReactNode;
    className?: string;
}
export declare function Toast({ tone, title, onClose, children, className }: ToastProps): import("react").JSX.Element;
interface ToastApi {
    push: (spec: Omit<ToastSpec, 'id'>) => void;
    success: (title: string, body?: string) => void;
    error: (title: string, body?: string) => void;
}
/**
 * Wraps the app once. Toasts are the standard way SSM confirms a mutation —
 * the error copy rule applies: say what happened and what to do next.
 */
export declare function ToastProvider({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
export declare function useToast(): ToastApi;
export {};
//# sourceMappingURL=Toast.d.ts.map