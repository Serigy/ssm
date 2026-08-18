import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';

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

type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type LinkProps = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/**
 * Label rule from the design system: verb + object, 2–4 words, sentence case.
 * "Emitir fatura", never "Clique aqui".
 */
export function Button(props: ButtonProps | LinkProps) {
  const {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    icon,
    loading = false,
    children,
    className,
    ...rest
  } = props as Common & { className?: string; href?: string };

  const cls = cx(
    'ssm-btn',
    `ssm-btn--${variant}`,
    `ssm-btn--${size}`,
    fullWidth && 'ssm-btn--full',
    className,
  );

  const content = (
    <>
      {icon}
      {children}
    </>
  );

  if ('href' in props && props.href) {
    const { href, ...anchorRest } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & {
      href: string;
    };
    return (
      <a className={cls} href={href} {...anchorRest}>
        {content}
      </a>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      type={buttonRest.type ?? 'button'}
      className={cls}
      // aria-busy rather than removing the label: a screen reader should still
      // hear what the button does while it is working.
      aria-busy={loading || undefined}
      {...buttonRest}
      disabled={buttonRest.disabled || loading}
    >
      {content}
    </button>
  );
}
