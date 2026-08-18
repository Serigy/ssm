import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';
import { Field } from './Field.js';
import type { ControlSize } from './Button.js';

export type SelectOption = { value: string; label: string } | string;

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  size?: ControlSize;
  options: SelectOption[];
  /** Leading blank option, e.g. "Todos os estados". */
  placeholder?: string;
}

export function Select({
  label,
  hint,
  error,
  required,
  size = 'md',
  options,
  placeholder,
  id,
  className,
  ...rest
}: SelectProps) {
  const generated = useId();
  const selectId = id ?? generated;

  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={selectId}>
      <div className={cx('ssm-select', `ssm-select--${size}`, className)}>
        <select
          id={selectId}
          className="ssm-select__control"
          required={required}
          aria-invalid={error ? true : undefined}
          {...rest}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => {
            const opt = typeof o === 'string' ? { value: o, label: o } : o;
            return (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            );
          })}
        </select>
        <span className="ssm-select__chevron" aria-hidden="true" />
      </div>
    </Field>
  );
}
