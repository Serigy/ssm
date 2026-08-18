import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
}

export function Radio({ label, hint, id, className, disabled, ...rest }: RadioProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <label
      htmlFor={inputId}
      className={cx('ssm-choice', disabled && 'ssm-choice--disabled', className)}
    >
      <input id={inputId} type="radio" className="ssm-choice__native" disabled={disabled} {...rest} />
      <span className="ssm-choice__box ssm-choice__box--radio" aria-hidden="true">
        <span className="ssm-choice__radio-dot" />
      </span>
      <span>
        <span className="ssm-choice__label">{label}</span>
        {hint && <span className="ssm-choice__hint">{hint}</span>}
      </span>
    </label>
  );
}
