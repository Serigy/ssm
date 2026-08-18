import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Module id, used in the fallback copy and the log line. */
  moduleId: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Isolates one remote's failures from the rest of the application.
 *
 * This matters more in a federated app than in a monolith: a remote is fetched
 * from a separate origin at runtime, so it can fail in ways a bundled module
 * cannot — the deployment is mid-rollout, the CDN 404s, the chunk hash moved.
 * Without a boundary, any of those blanks the whole page including the two
 * modules that are perfectly healthy.
 */
export class RemoteBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[mfe] module "${this.props.moduleId}" failed to render`, error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="ssm-empty">
          <div className="ssm-empty__title">Não foi possível carregar este módulo</div>
          <div className="ssm-empty__body">
            O módulo <strong>{this.props.moduleId}</strong> não respondeu. Os demais módulos
            seguem disponíveis. Recarregue a página; se o erro continuar, informe a equipe de
            plantão.
          </div>

          {/*
            The technical cause, in development only. A federated remote fails
            for reasons the friendly message cannot express — a version mismatch
            on a shared singleton, a chunk 404 mid-rollout, a CORS refusal — and
            hiding it behind "não respondeu" means the developer has to open the
            console to learn anything. In production it stays hidden: the message
            would leak build internals to a user who cannot act on them.
          */}
          {import.meta.env.DEV && (
            <pre
              style={{
                maxWidth: '80ch',
                whiteSpace: 'pre-wrap',
                textAlign: 'left',
                fontSize: 'var(--text-2xs)',
                color: 'var(--state-danger)',
                background: 'var(--state-danger-bg)',
                border: '1px solid var(--state-danger)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-4)',
                margin: 0,
                overflowX: 'auto',
              }}
            >
              {this.state.error.name}: {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
            </pre>
          )}

          <button
            type="button"
            className="ssm-btn ssm-btn--secondary ssm-btn--md"
            onClick={() => this.setState({ error: null })}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Boundary + Suspense in one wrapper, which is how the shell always uses it. */
export function RemoteSlot({ moduleId, children }: Props) {
  return (
    <RemoteBoundary moduleId={moduleId}>
      <Suspense fallback={<div className="ssm-loadbar" role="progressbar" aria-label="Carregando módulo" />}>
        {children}
      </Suspense>
    </RemoteBoundary>
  );
}
