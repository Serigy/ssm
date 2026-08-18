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
  formatDate,
  formatMoney,
  type Column,
} from '@ssm/ui-kit';
import { useHost, useQuery } from '@ssm/mfe-runtime';
import type { Invoice, InvoiceStatus } from '@ssm/contracts';
import { financialApi } from '../api.js';
import { STATUS_LABEL, STATUS_TONE, isOverdue } from '../status.js';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'issued', label: 'Emitida' },
  { value: 'partially_paid', label: 'Parcial' },
  { value: 'paid', label: 'Paga' },
  { value: 'void', label: 'Cancelada' },
];

export function InvoiceListScreen() {
  const { api, can, setPageTitle, locale } = useHost();
  const navigate = useNavigate();

  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => setPageTitle('Faturas', 'FINANCEIRO'), [setPageTitle]);

  // Debounce so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, loading, error, refetch } = useQuery(
    () =>
      financialApi.list(api, {
        status: status || undefined,
        q: debounced || undefined,
        limit: 25,
      }),
    [status, debounced],
  );

  const columns: Column<Invoice>[] = [
    {
      key: 'number',
      header: 'Número',
      render: (i) => (
        <span className="ssm-num">{i.number ?? <em style={{ color: 'var(--text-muted)' }}>rascunho</em>}</span>
      ),
    },
    { key: 'counterparty', header: 'Contraparte', render: (i) => i.counterpartyName },
    {
      key: 'status',
      header: 'Estado',
      render: (i) => (
        <Badge tone={STATUS_TONE[i.status]} dot>
          {STATUS_LABEL[i.status]}
        </Badge>
      ),
    },
    {
      key: 'due',
      header: 'Vencimento',
      render: (i) =>
        isOverdue(i.dueDate, i.status) ? (
          <span style={{ color: 'var(--state-danger)' }}>{formatDate(i.dueDate, locale)}</span>
        ) : (
          formatDate(i.dueDate, locale)
        ),
    },
    { key: 'total', header: 'Total', numeric: true, render: (i) => formatMoney(i.total, locale) },
    {
      key: 'balance',
      header: 'Em aberto',
      numeric: true,
      render: (i) =>
        formatMoney(
          { amountMinor: i.total.amountMinor - i.amountPaid.amountMinor, currency: i.currency },
          locale,
        ),
    },
  ];

  return (
    <div className="ssm-stack">
      <div className="ssm-toolbar">
        <Input
          placeholder="Buscar por número ou contraparte"
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
          onChange={(e) => setStatus(e.target.value as InvoiceStatus | '')}
        />
        <div className="ssm-toolbar__spacer" />
        {can('financial:invoice:create') && (
          <Button onClick={() => navigate('/financeiro/faturas/nova')}>Emitir fatura</Button>
        )}
      </div>

      {loading && <LoadingBar />}

      {error && (
        <EmptyState
          title="Não foi possível carregar as faturas"
          body={error.message}
          action={
            <Button variant="secondary" onClick={refetch}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!loading && !error && (
        <Panel title={`${data?.items.length ?? 0} fatura(s)`} padded={false}>
          <Table
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(i) => i.id}
            onRowClick={(i) => navigate(`/financeiro/faturas/${i.id}`)}
            empty={
              <EmptyState
                title="Nenhuma fatura por aqui"
                body={
                  status || debounced
                    ? 'Nenhum resultado para o filtro atual. Ajuste a busca ou limpe o estado selecionado.'
                    : 'Ainda não há faturas neste ambiente. Comece emitindo a primeira.'
                }
                action={
                  can('financial:invoice:create') ? (
                    <Button onClick={() => navigate('/financeiro/faturas/nova')}>
                      Emitir fatura
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </Panel>
      )}
    </div>
  );
}
