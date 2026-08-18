import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../utils/cx.js';

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** Shared label/hint/error envelope, so no control re-invents the structure. */
export function Field({ label, hint, error, required, htmlFor, className, style, children }: FieldProps) {
  const describedBy = htmlFor ? `${htmlFor}-desc` : undefined;
  return (
    <div className={cx('ssm-field', className)} style={style}>
      {label && (
        <label className="ssm-field__label" htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="ssm-field__required" aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </label>
      )}
      {children}
      {(error || hint) && (
        <div
          id={describedBy}
          className={error ? 'ssm-field__error' : 'ssm-field__hint'}
          // Errors must be announced when they appear, hints must not.
          role={error ? 'alert' : undefined}
        >
          {error || hint}
        </div>
      )}
    </div>
  );
}
