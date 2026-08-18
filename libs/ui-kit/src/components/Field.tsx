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
        // The required marker is drawn by CSS (::after on .ssm-field__label--required),
        // never as a text node. A "*" inside the label becomes part of the
        // field's name: assistive technology reads "Contraparte asterisk", and
        // any tooling that matches on the label — a test, an autofill heuristic —
        // has to know about the decoration. The `required` attribute on the
        // control already carries the meaning; this is purely visual.
        <label
          className={cx('ssm-field__label', required && 'ssm-field__label--required')}
          htmlFor={htmlFor}
        >
          {label}
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
