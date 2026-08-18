import { useState, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

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
export function Tabs({ items, value, onChange, className, ...rest }: TabsProps) {
  const [internal, setInternal] = useState(items[0]?.value ?? '');
  const active = value ?? internal;

  const pick = (v: string) => {
    if (value === undefined) setInternal(v);
    onChange?.(v);
  };

  return (
    <div role="tablist" className={cx('ssm-tabs', className)} {...rest}>
      {items.map((t) => {
        const on = t.value === active;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            // Roving tabindex: one stop for the whole tablist, then arrow keys —
            // the pattern screen-reader users expect from a tab set.
            tabIndex={on ? 0 : -1}
            className="ssm-tab"
            onClick={() => pick(t.value)}
            onKeyDown={(e) => {
              const i = items.findIndex((x) => x.value === active);
              if (e.key === 'ArrowRight') pick(items[(i + 1) % items.length]!.value);
              if (e.key === 'ArrowLeft') pick(items[(i - 1 + items.length) % items.length]!.value);
            }}
          >
            {t.label}
            {t.count !== undefined && <span className="ssm-tab__count">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
