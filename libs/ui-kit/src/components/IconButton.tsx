import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import type { ControlSize } from './Button.js';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: an icon alone is unreadable without it. */
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: ControlSize;
  children: ReactNode;
}

export function IconButton({
  label,
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('ssm-iconbtn', `ssm-iconbtn--${variant}`, `ssm-iconbtn--${size}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
