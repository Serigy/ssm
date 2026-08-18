import { cx } from '../utils/cx.js';

interface MetricProps {
  label: string;
  value: string;
  delta?: string;
  tone?: 'neutral' | 'up' | 'down';
  className?: string;
}

/** Promoted from the design system's painel kit, as its README anticipated. */
export function Metric({ label, value, delta, tone = 'neutral', className }: MetricProps) {
  return (
    <div className={cx('ssm-metric', className)}>
      <div className="ssm-metric__label">{label}</div>
      <div className="ssm-metric__value">{value}</div>
      {delta && (
        <div className={cx('ssm-metric__delta', tone !== 'neutral' && `ssm-metric__delta--${tone}`)}>
          {delta}
        </div>
      )}
    </div>
  );
}
