import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';

// `title` is omitted from the DOM attributes on purpose: HTMLAttributes declares
// it as the string tooltip attribute, while here it is the card's heading and
// may be any ReactNode. Keeping both would be a type conflict, and the heading
// is the one callers mean.
interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  eyebrow?: ReactNode;
  title?: ReactNode;
  footer?: ReactNode;
  interactive?: boolean;
  tone?: 'default' | 'sunken' | 'inverse';
  children?: ReactNode;
}

export function Card({
  eyebrow,
  title,
  footer,
  interactive = false,
  tone = 'default',
  className,
  children,
  ...rest
}: CardProps) {
  const clickable = interactive || Boolean(rest.onClick);
  return (
    <div
      className={cx(
        'ssm-card',
        tone !== 'default' && `ssm-card--${tone}`,
        clickable && 'ssm-card--interactive',
        className,
      )}
      // A div that responds to clicks must also respond to Enter/Space, or it
      // is unusable without a mouse.
      {...(clickable ? { role: 'button', tabIndex: 0 } : {})}
      {...rest}
    >
      {eyebrow && <div className="ssm-card__eyebrow">{eyebrow}</div>}
      {title && <div className="ssm-card__title">{title}</div>}
      {children && <div className="ssm-card__body">{children}</div>}
      {footer && <div className="ssm-card__footer">{footer}</div>}
    </div>
  );
}
