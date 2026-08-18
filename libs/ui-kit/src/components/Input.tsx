import { useId, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import { Field } from './Field.js';
import type { ControlSize } from './Button.js';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  size?: ControlSize;
  icon?: ReactNode;
  /** Right-hand adornment: a unit, a currency code, a clear button. */
  suffix?: ReactNode;
  className?: string;
  /** Applied to the Field wrapper — use for sizing, e.g. { minWidth: 280 }. */
  wrapperStyle?: CSSProperties;
}

export function Input({
  label,
  hint,
  error,
  required,
  size = 'md',
  icon,
  suffix,
  id,
  className,
  wrapperStyle,
  disabled,
  ...rest
}: InputProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={inputId}
      style={wrapperStyle}
    >
      <div
        className={cx(
          'ssm-input',
          `ssm-input--${size}`,
          error && 'ssm-input--invalid',
          disabled && 'ssm-input--disabled',
          className,
        )}
      >
        {icon && (
          <span className="ssm-input__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <input
          id={inputId}
          className="ssm-input__control"
          disabled={disabled}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${inputId}-desc` : undefined}
          {...rest}
        />
        {suffix && <span className="ssm-input__icon">{suffix}</span>}
      </div>
    </Field>
  );
}
