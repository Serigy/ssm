import { useEffect, useState } from 'react';
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
  Tag,
  formatDateTime,
  type Column,
} from '@ssm/ui-kit';
import { useHost, useQuery } from '@ssm/mfe-runtime';
import type { Environment, EnvironmentStatus } from '@ssm/contracts';
import { operationsApi } from '../api.js';
import { ENV_KIND_LABEL, ENV_STATUS_LABEL, ENV_STATUS_TONE, formatBpsPercent } from '../status.js';

const STATUS_OPTIONS = Object.entries(ENV_STATUS_LABEL).map(([value, label]) => ({ value, label }));

/** The inventory. Incidents float to the top, because that is why it is opened. */
export function EnvironmentListScreen() {
  const { api, setPageTitle, locale } = useHost();
  const [status, setStatus] = useState<EnvironmentStatus | ''>('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => setPageTitle('Ambientes', 'OPERAÇÕES'), [setPageTitle]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, loading, error, refetch } = useQuery(
    () =>
      operationsApi.environments.list(api, {
        status: status || undefined,
        q: debounced || undefined,
        limit: 50,
      }),
    [status, debounced],
  );

  const items = data?.items ?? [];
  const emIncidente = items.filter((e) => e.status === 'incident');
  const emJanela = items.filter((e) => e.status === 'scheduled_window');

  const columns: Column<Environment>[] = [
    { key: 'code', header: 'Ambiente', render: (e) => <span className="ssm-num">{e.code}</span> },
    { key: 'name', header: 'Nome', render: (e) => e.name },
    { key: 'kind', header: 'Tipo', render: (e) => ENV_KIND_LABEL[e.kind] ?? e.kind },
    {
      key: 'status',
      header: 'Estado',
      render: (e) => (
        <Badge tone={ENV_STATUS_TONE[e.status]} dot>
          {ENV_STATUS_LABEL[e.status]}
        </Badge>
      ),
    },
    { key: 'region', header: 'Região', render: (e) => e.region ?? '—' },
    {
      key: 'target',
      header: 'Meta',
      numeric: true,
      render: (e) => formatBpsPercent(e.availabilityTargetBps),
    },
    {
      key: 'window',
      header: 'Próxima janela',
      render: (e) =>
        e.nextWindow ? (
          formatDateTime(e.nextWindow.startsAt, locale)
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>nenhuma</span>
        ),
    },
    {
      key: 'tags',
      header: 'Etiquetas',
      render: (e) => (
        <span className="ssm-row" style={{ flexWrap: 'wrap' }}>
          {e.tags.slice(0, 3).map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </span>
      ),
    },
  ];

  return (
    <div className="ssm-stack">
      <div className="ssm-grid-metrics">
        <Metric label="INVENTÁRIO" value={String(items.length)} />
        <Metric
          label="EM INCIDENTE"
          value={String(emIncidente.length)}
          tone={emIncidente.length ? 'down' : 'up'}
          delta={emIncidente.map((e) => e.code).join(', ') || 'nenhum'}
        />
        <Metric label="JANELA AGENDADA" value={String(emJanela.length)} />
      </div>

      <div className="ssm-toolbar">
        <Input
          placeholder="Buscar por código ou nome"
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
          onChange={(e) => setStatus(e.target.value as EnvironmentStatus | '')}
        />
      </div>

      {loading && <LoadingBar />}
      {error && (
        <EmptyState
          title="Não foi possível carregar o inventário"
          body={error.message}
          action={
            <Button variant="secondary" onClick={refetch}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!loading && !error && (
        <Panel title={`${items.length} ambiente(s)`} padded={false}>
          <Table
            columns={columns}
            rows={items}
            rowKey={(e) => e.id}
            empty={
              <EmptyState
                title="Nenhum ambiente cadastrado"
                body="Ambientes sob sustentação aparecem aqui, com o estado e a meta de disponibilidade que o contrato define."
              />
            }
          />
        </Panel>
      )}
    </div>
  );
}
