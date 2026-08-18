import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';

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
export function Badge({ tone = 'neutral', dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx('ssm-badge', `ssm-badge--${tone}`, className)} {...rest}>
      {dot && <i className="ssm-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
