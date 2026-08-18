import { useEffect } from 'react';
import { Badge, Card, Metric, Panel } from '@ssm/ui-kit';
import { useHost, useQuery } from '@ssm/mfe-runtime';

interface StatusResponse {
  status: string;
  env: string;
  version: string;
  modules: Record<string, 'up' | 'degraded' | 'down'>;
}

const MODULE_LABELS: Record<string, string> = {
  identity: 'Identidade',
  financial: 'Financeiro',
  hr: 'Pessoas',
  legal: 'Jurídico',
};

/**
 * The landing screen. Deliberately thin: it shows platform state and points at
 * the modules. Any real business metric belongs inside the module that owns the
 * data, not aggregated here — the shell must stay ignorant of domain logic.
 */
export function Dashboard() {
  const { session, setPageTitle } = useHost();
  const { data, loading } = useQuery<StatusResponse>(
    () => fetch('/api/v1/status').then((r) => r.json() as Promise<StatusResponse>),
    [],
  );

  useEffect(() => {
    setPageTitle('Visão geral', `${session.user.email} · ${session.modules.length} módulo(s)`);
  }, [setPageTitle, session]);

  return (
    <div className="ssm-stack">
      <div className="ssm-grid-metrics">
        <Metric label="MÓDULOS ATIVOS" value={String(session.modules.length)} />
        <Metric label="PERMISSÕES" value={String(session.permissions.length)} />
        <Metric label="PAPÉIS" value={String(session.user.roles.length)} />
        <Metric
          label="PLATAFORMA"
          value={loading ? '—' : (data?.status === 'ok' ? 'OK' : 'DEGRADADA')}
          delta={data?.version}
          tone={data?.status === 'ok' ? 'up' : 'down'}
        />
      </div>

      <Panel title="Estado dos serviços">
        <div className="ssm-stack" style={{ gap: 'var(--space-3)' }}>
          {Object.entries(data?.modules ?? {}).map(([name, state]) => (
            <div key={name} className="ssm-row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 'var(--text-sm)' }}>{MODULE_LABELS[name] ?? name}</span>
              <Badge tone={state === 'up' ? 'success' : state === 'degraded' ? 'warning' : 'danger'} dot>
                {state === 'up' ? 'Operacional' : state === 'degraded' ? 'Degradado' : 'Fora do ar'}
              </Badge>
            </div>
          ))}
          {!loading && !data && (
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              Não foi possível consultar o estado dos serviços. Os módulos seguem acessíveis pelo menu.
            </span>
          )}
        </div>
      </Panel>

      <Card eyebrow="ACESSO" title="Seus papéis">
        {session.user.roles.join(' · ') || 'Nenhum papel atribuído. Procure um administrador.'}
      </Card>
    </div>
  );
}
