import { useState, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

interface TooltipProps {
  label: string;
  placement?: 'top' | 'bottom';
  children: ReactNode;
}

export function Tooltip({ label, placement = 'top', children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="ssm-tooltip-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // Focus as well as hover, so the tip is reachable from the keyboard.
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span role="tooltip" className={cx('ssm-tooltip', placement === 'bottom' && 'ssm-tooltip--bottom')}>
          {label}
        </span>
      )}
    </span>
  );
}
