import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingBar,
  Metric,
  Panel,
  Select,
  Table,
  formatDateTime,
  type Column,
} from '@ssm/ui-kit';
import { useHost, useQuery } from '@ssm/mfe-runtime';
import type { Severity, Ticket, TicketStatus } from '@ssm/contracts';
import { operationsApi } from '../api.js';
import {
  SEVERITY_LABEL,
  SEVERITY_TONE,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  formatDeadline,
} from '../status.js';

const STATUS_OPTIONS = Object.entries(TICKET_STATUS_LABEL).map(([value, label]) => ({ value, label }));
const SEVERITY_OPTIONS = Object.entries(SEVERITY_LABEL).map(([value, label]) => ({ value, label }));

/**
 * The on-call queue.
 *
 * Ordered by severity before recency, because that is how the person holding
 * the pager reads it: an open sev1 belongs at the top no matter when it arrived.
 */
export function TicketListScreen() {
  const { api, can, setPageTitle, locale } = useHost();
  const navigate = useNavigate();

  const [status, setStatus] = useState<TicketStatus | ''>('');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => setPageTitle('Chamados', 'OPERAÇÕES'), [setPageTitle]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, loading, error, refetch } = useQuery(
    () =>
      operationsApi.tickets.list(api, {
        status: status || undefined,
        severity: severity || undefined,
        q: debounced || undefined,
        limit: 25,
      }),
    [status, severity, debounced],
  );

  const items = data?.items ?? [];
  const abertos = items.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const sev1 = abertos.filter((t) => t.severity === 'sev1');
  const foraDoPrazo = items.filter((t) => t.responseBreached);

  const columns: Column<Ticket>[] = [
    { key: 'number', header: 'Chamado', render: (t) => <span className="ssm-num">#{t.number}</span> },
    { key: 'subject', header: 'Assunto', render: (t) => t.subject },
    {
      key: 'env',
      header: 'Ambiente',
      render: (t) =>
        t.environmentCode ? (
          <span className="ssm-num">{t.environmentCode}</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ),
    },
    {
      key: 'severity',
      header: 'Severidade',
      render: (t) => <Badge tone={SEVERITY_TONE[t.severity]}>{SEVERITY_LABEL[t.severity]}</Badge>,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (t) => (
        <Badge tone={TICKET_STATUS_TONE[t.status]} dot>
          {TICKET_STATUS_LABEL[t.status]}
        </Badge>
      ),
    },
    {
      key: 'sla',
      header: 'Prazo',
      render: (t) => (
        <span style={t.responseBreached ? { color: 'var(--state-danger)' } : undefined}>
          {formatDeadline(t.responseDueAt, t.firstResponseAt)}
        </span>
      ),
    },
    { key: 'opened', header: 'Abertura', render: (t) => formatDateTime(t.openedAt, locale) },
  ];

  return (
    <div className="ssm-stack">
      <div className="ssm-grid-metrics">
        <Metric label="EM ABERTO" value={String(abertos.length)} />
        <Metric
          label="SEVERIDADE 1"
          value={String(sev1.length)}
          tone={sev1.length ? 'down' : 'neutral'}
        />
        <Metric
          label="FORA DO PRAZO"
          value={String(foraDoPrazo.length)}
          tone={foraDoPrazo.length ? 'down' : 'up'}
          delta={foraDoPrazo.length ? 'entram na apuração do mês' : 'nenhum descumprimento'}
        />
        <Metric label="NA LISTA" value={String(items.length)} />
      </div>

      <div className="ssm-toolbar">
        <Input
          placeholder="Buscar por assunto ou ambiente"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="sm"
          wrapperStyle={{ minWidth: 280 }}
        />
        <Select
          options={STATUS_OPTIONS}
          placeholder="Todos os estados"
          value={status}
          size="sm"
          onChange={(e) => setStatus(e.target.value as TicketStatus | '')}
        />
        <Select
          options={SEVERITY_OPTIONS}
          placeholder="Todas as severidades"
          value={severity}
          size="sm"
          onChange={(e) => setSeverity(e.target.value as Severity | '')}
        />
        <div className="ssm-toolbar__spacer" />
        {can('operations:ticket:create') && (
          <Button onClick={() => navigate('/operacoes/chamados/novo')}>Abrir chamado</Button>
        )}
      </div>

      {loading && <LoadingBar />}
      {error && (
        <EmptyState
          title="Não foi possível carregar os chamados"
          body={error.message}
          action={
            <Button variant="secondary" onClick={refetch}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!loading && !error && (
        <Panel title={`${items.length} chamado(s)`} padded={false}>
          <Table
            columns={columns}
            rows={items}
            rowKey={(t) => t.id}
            onRowClick={(t) => navigate(`/operacoes/chamados/${t.id}`)}
            empty={
              <EmptyState
                title="Nenhum chamado por aqui"
                body={
                  status || severity || debounced
                    ? 'Nenhum resultado para o filtro atual. Ajuste a busca ou limpe os filtros.'
                    : 'Nenhum chamado aberto. É o estado que se quer.'
                }
              />
            }
          />
        </Panel>
      )}
    </div>
  );
}
