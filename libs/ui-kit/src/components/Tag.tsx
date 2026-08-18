import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';

interface TagProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'onClick'> {
  selected?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
  children: ReactNode;
}

export function Tag({ selected = false, onRemove, onClick, className, children, ...rest }: TagProps) {
  return (
    <span
      className={cx(
        'ssm-tag',
        selected && 'ssm-tag--selected',
        onClick && 'ssm-tag--clickable',
        onRemove && 'ssm-tag--removable',
        className,
      )}
      onClick={onClick}
      {...(onClick ? { role: 'button', tabIndex: 0 } : {})}
      {...rest}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          className="ssm-tag__remove"
          aria-label={`Remover ${typeof children === 'string' ? children : 'etiqueta'}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}
