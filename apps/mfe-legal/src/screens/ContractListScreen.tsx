import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingBar,
  Panel,
  Select,
  Table,
  Tag,
  formatDate,
  formatMoney,
  type Column,
} from '@ssm/ui-kit';
import { useHost, useQuery } from '@ssm/mfe-runtime';
import type { Contract, ContractStatus } from '@ssm/contracts';
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, daysUntil } from '../status.js';
import { legalApi } from '../api.js';

const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }));
const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));

export function ContractListScreen() {
  const { api, can, setPageTitle, locale } = useHost();
  const navigate = useNavigate();

  const [status, setStatus] = useState<ContractStatus | ''>('');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => setPageTitle('Contratos', 'JURÍDICO'), [setPageTitle]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, loading, error, refetch } = useQuery(
    () =>
      legalApi.list(api, {
        status: status || undefined,
        kind: (kind || undefined) as never,
        q: debounced || undefined,
        limit: 25,
      }),
    [status, kind, debounced],
  );

  const columns: Column<Contract>[] = [
    { key: 'ref', header: 'Referência', render: (c) => <span className="ssm-num">{c.reference}</span> },
    { key: 'title', header: 'Objeto', render: (c) => c.title },
    { key: 'kind', header: 'Tipo', render: (c) => KIND_LABEL[c.kind] ?? c.kind },
    {
      key: 'parties',
      header: 'Contraparte',
      render: (c) => c.parties.find((p) => p.role === 'counterparty')?.name ?? '—',
    },
    {
      key: 'status',
      header: 'Situação',
      render: (c) => (
        <Badge tone={STATUS_TONE[c.status]} dot>
          {STATUS_LABEL[c.status]}
        </Badge>
      ),
    },
    {
      key: 'until',
      header: 'Vigência até',
      render: (c) => {
        const days = daysUntil(c.effectiveTo);
        if (!c.effectiveTo) return <span style={{ color: 'var(--text-muted)' }}>indeterminada</span>;
        const warn = days !== null && days <= c.renewalNoticeDays;
        return (
          <span style={warn ? { color: 'var(--state-warning)' } : undefined}>
            {formatDate(c.effectiveTo, locale)}
            {warn && days !== null && ` · ${days}d`}
          </span>
        );
      },
    },
    { key: 'value', header: 'Valor', numeric: true, render: (c) => formatMoney(c.value, locale) },
  ];

  return (
    <div className="ssm-stack">
      <div className="ssm-toolbar">
        <Input
          placeholder="Buscar por referência, objeto ou parte"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="sm"
          wrapperStyle={{ minWidth: 300 }}
        />
        <Select
          options={STATUS_OPTIONS}
          placeholder="Todas as situações"
          value={status}
          size="sm"
          onChange={(e) => setStatus(e.target.value as ContractStatus | '')}
        />
        <Select
          options={KIND_OPTIONS}
          placeholder="Todos os tipos"
          value={kind}
          size="sm"
          onChange={(e) => setKind(e.target.value)}
        />
        <div className="ssm-toolbar__spacer" />
        {can('legal:contract:create') && (
          <Button onClick={() => navigate('/juridico/contratos/novo')}>Cadastrar contrato</Button>
        )}
      </div>

      {loading && <LoadingBar />}

      {error && (
        <EmptyState
          title="Não foi possível carregar os contratos"
          body={error.message}
          action={
            <Button variant="secondary" onClick={refetch}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!loading && !error && (
        <Panel title={`${data?.items.length ?? 0} contrato(s)`} padded={false}>
          <Table
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(c) => c.id}
            onRowClick={(c) => navigate(`/juridico/contratos/${c.id}`)}
            empty={
              <EmptyState
                title="Nenhum contrato encontrado"
                body={
                  status || kind || debounced
                    ? 'Nenhum resultado para o filtro atual. Ajuste a busca ou limpe os filtros.'
                    : 'Ainda não há contratos cadastrados neste ambiente.'
                }
              />
            }
          />
        </Panel>
      )}
    </div>
  );
}
