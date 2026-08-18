import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  width?: number;
  children?: ReactNode;
}

/**
 * Modal dialog. Adds three things the prototype could not: Escape to close,
 * focus moved into the dialog on open and restored on close, and a focus trap.
 * Without them a keyboard user can tab out of a modal into the page behind it.
 */
export function Dialog({
  open,
  title,
  description,
  footer,
  onClose,
  width = 480,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;
    // Give the browser a frame to paint before pulling focus.
    const raf = requestAnimationFrame(() => {
      const focusable = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
      (focusable ?? ref.current)?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;

      const nodes = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null,
      );
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ssm-dialog-scrim" role="presentation" onClick={() => onClose?.()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="ssm-dialog"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ssm-dialog__head">
          <div className="ssm-dialog__title" id={titleId}>
            {title}
          </div>
          {onClose && (
            <button
              type="button"
              className="ssm-dialog__close"
              aria-label="Fechar"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>
        {description && <div className="ssm-dialog__desc">{description}</div>}
        {children}
        {footer && <div className="ssm-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
