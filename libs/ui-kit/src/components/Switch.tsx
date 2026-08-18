import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
}

export function Switch({ label, id, className, disabled, ...rest }: SwitchProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <label
      htmlFor={inputId}
      className={cx('ssm-switch', disabled && 'ssm-switch--disabled', className)}
    >
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        className="ssm-choice__native"
        disabled={disabled}
        {...rest}
      />
      <span className="ssm-switch__track" aria-hidden="true">
        <span className="ssm-switch__thumb" />
      </span>
      {label && <span className="ssm-choice__label">{label}</span>}
    </label>
  );
}
