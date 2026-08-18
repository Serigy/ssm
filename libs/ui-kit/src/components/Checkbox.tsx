import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
}

export function Checkbox({ label, hint, id, className, disabled, ...rest }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <label
      htmlFor={inputId}
      className={cx('ssm-choice', disabled && 'ssm-choice--disabled', className)}
    >
      {/* The native input stays in the DOM and keeps focus; the box is painted
          from its :checked / :focus-visible state, so keyboard use is unaffected. */}
      <input
        id={inputId}
        type="checkbox"
        className="ssm-choice__native"
        disabled={disabled}
        {...rest}
      />
      <span className="ssm-choice__box" aria-hidden="true">
        <span className="ssm-choice__check" />
      </span>
      <span>
        <span className="ssm-choice__label">{label}</span>
        {hint && <span className="ssm-choice__hint">{hint}</span>}
      </span>
    </label>
  );
}
