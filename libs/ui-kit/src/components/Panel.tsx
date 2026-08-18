import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';

interface PanelProps {
  title: ReactNode;
  action?: ReactNode;
  /** Set false when the body is a table, which brings its own padding. */
  padded?: boolean;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, action, padded = true, className, children }: PanelProps) {
  return (
    <section className={cx('ssm-panel', className)}>
      <div className="ssm-panel__head">
        <div className="ssm-panel__title">{title}</div>
        {action}
      </div>
      <div className={cx('ssm-panel__body', !padded && 'ssm-panel__body--flush')}>{children}</div>
    </section>
  );
}
