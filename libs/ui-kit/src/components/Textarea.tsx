import { useId, type CSSProperties, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';
import { Field } from './Field.js';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  wrapperStyle?: CSSProperties;
}

/**
 * Multi-line text. Shares the Field envelope and the input chrome with Input,
 * so a form does not mix two visual languages for what the user reads as the
 * same kind of control.
 */
export function Textarea({
  label,
  hint,
  error,
  required,
  id,
  className,
  wrapperStyle,
  rows = 4,
  disabled,
  ...rest
}: TextareaProps) {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={fieldId}
      style={wrapperStyle}
    >
      <div
        className={cx(
          'ssm-input ssm-input--area',
          error && 'ssm-input--invalid',
          disabled && 'ssm-input--disabled',
          className,
        )}
      >
        <textarea
          id={fieldId}
          rows={rows}
          className="ssm-input__control ssm-input__control--area"
          disabled={disabled}
          required={required}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
      </div>
    </Field>
  );
}
