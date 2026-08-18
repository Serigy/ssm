import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastSpec {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
}

interface ToastProps {
  tone?: ToastTone;
  title?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
  className?: string;
}

const DEFAULT_TITLES: Record<ToastTone, string> = {
  info: 'Informação',
  success: 'Concluído',
  warning: 'Atenção',
  danger: 'Erro',
};

export function Toast({ tone = 'info', title, onClose, children, className }: ToastProps) {
  return (
    <div
      className={cx('ssm-toast', tone !== 'info' && `ssm-toast--${tone}`, className)}
      // Errors interrupt; everything else waits for a pause in speech.
      role={tone === 'danger' ? 'alert' : 'status'}
      aria-live={tone === 'danger' ? 'assertive' : 'polite'}
    >
      <div style={{ flex: 1 }}>
        <div className="ssm-toast__title">{title ?? DEFAULT_TITLES[tone]}</div>
        {children && <div className="ssm-toast__body">{children}</div>}
      </div>
      {onClose && (
        <button type="button" className="ssm-toast__close" aria-label="Fechar" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
}

interface ToastApi {
  push: (spec: Omit<ToastSpec, 'id'>) => void;
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Wraps the app once. Toasts are the standard way SSM confirms a mutation —
 * the error copy rule applies: say what happened and what to do next.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastSpec[]>([]);

  const remove = useCallback((id: string) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (spec: Omit<ToastSpec, 'id'>) => {
      const id = crypto.randomUUID();
      setItems((cur) => [...cur, { ...spec, id }]);
      // Errors stay until dismissed; anything else clears itself.
      if (spec.tone !== 'danger') setTimeout(() => remove(id), 6000);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, body) => push({ tone: 'success', title, body }),
      error: (title, body) => push({ tone: 'danger', title, body }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ssm-toast-region">
        {items.map((t) => (
          <Toast key={t.id} tone={t.tone} title={t.title} onClose={() => remove(t.id)}>
            {t.body}
          </Toast>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
