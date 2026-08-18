import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  /** Says what happened and what to do next — never blames the user. */
  body?: string;
  action?: ReactNode;
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="ssm-empty">
      <div className="ssm-empty__title">{title}</div>
      {body && <div className="ssm-empty__body">{body}</div>}
      {action}
    </div>
  );
}

/** The 2px bar is the only looping animation the design system allows. */
export function LoadingBar() {
  return <div className="ssm-loadbar" role="progressbar" aria-label="Carregando" />;
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: string }) {
  return <div className="ssm-skeleton" style={{ height, width }} aria-hidden="true" />;
}
