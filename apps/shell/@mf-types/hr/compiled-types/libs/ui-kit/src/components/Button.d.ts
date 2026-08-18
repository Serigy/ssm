import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ControlSize = 'sm' | 'md' | 'lg';
interface Common {
    variant?: ButtonVariant;
    size?: ControlSize;
    fullWidth?: boolean;
    /** Leading glyph. Lucide at 20px for md — see the iconography rules. */
    icon?: ReactNode;
    /** Renders the disabled look and blocks activation while staying focusable. */
    loading?: boolean;
    children?: ReactNode;
}
type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
};
type LinkProps = Common & AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
};
/**
 * Label rule from the design system: verb + object, 2–4 words, sentence case.
 * "Emitir fatura", never "Clique aqui".
 */
export declare function Button(props: ButtonProps | LinkProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Button.d.ts.map