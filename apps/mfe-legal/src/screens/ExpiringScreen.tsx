import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  EmptyState,
  LoadingBar,
  Metric,
  Panel,
  Select,
  Table,
  formatDate,
  formatMoney,
  type Column,
} from '@ssm/ui-kit';
import { useHost, useQuery } from '@ssm/mfe-runtime';
import type { Contract } from '@ssm/contracts';
import { legalApi } from '../api.js';
import { daysUntil } from '../status.js';

const WINDOWS = [
  { value: '30', label: 'Próximos 30 dias' },
  { value: '60', label: 'Próximos 60 dias' },
  { value: '90', label: 'Próximos 90 dias' },
  { value: '180', label: 'Próximos 180 dias' },
];

/**
 * Reads the same endpoint that feeds the daily `legal.contract.expiring`
 * notice, so what a lawyer sees here and what lands in their inbox can never
 * disagree.
 */
export function ExpiringScreen() {
  const { api, setPageTitle, locale } = useHost();
  const navigate = useNavigate();
  const [window, setWindow] = useState('60');

  useEffect(() => setPageTitle('Vencimentos', 'JURÍDICO'), [setPageTitle]);

  const { data, loading, error, refetch } = useQuery(
    () => legalApi.expiring(api, Number(window)),
    [window],
  );

  const items = data ?? [];
  const urgent = items.filter((c) => (daysUntil(c.effectiveTo) ?? 999) <= 30);
  const autoRenew = items.filter((c) => c.autoRenew);

  const columns: Column<Contract>[] = [
    { key: 'ref', header: 'Referência', render: (c) => <span className="ssm-num">{c.reference}</span> },
    { key: 'title', header: 'Objeto', render: (c) => c.title },
    {
      key: 'days',
      header: 'Restam',
      numeric: true,
      render: (c) => {
        const d = daysUntil(c.effectiveTo);
        if (d === null) return '—';
        return (
          <Badge tone={d <= 15 ? 'danger' : d <= 30 ? 'warning' : 'neutral'}>{d} dias</Badge>
        );
      },
    },
    { key: 'until', header: 'Vence em', render: (c) => formatDate(c.effectiveTo, locale) },
    {
      key: 'renew',
      header: 'Renovação',
      render: (c) =>
        c.autoRenew ? (
          <Badge tone="info">Automática</Badge>
        ) : (
          <Badge tone="warning">Requer ação</Badge>
        ),
    },
    { key: 'value', header: 'Valor', numeric: true, render: (c) => formatMoney(c.value, locale) },
  ];

  return (
    <div className="ssm-stack">
      <div className="ssm-grid-metrics">
        <Metric label="NA JANELA" value={String(items.length)} />
        <Metric
          label="ATÉ 30 DIAS"
          value={String(urgent.length)}
          tone={urgent.length ? 'down' : 'neutral'}
        />
        <Metric label="RENOVAÇÃO AUTOMÁTICA" value={String(autoRenew.length)} />
        <Metric label="REQUEREM AÇÃO" value={String(items.length - autoRenew.length)} />
      </div>

      <div className="ssm-toolbar">
        <Select
          options={WINDOWS}
          value={window}
          size="sm"
          onChange={(e) => setWindow(e.target.value)}
        />
        <div className="ssm-toolbar__spacer" />
        <Button variant="secondary" size="sm" onClick={refetch}>
          Atualizar
        </Button>
      </div>

      {loading && <LoadingBar />}
      {error && <EmptyState title="Não foi possível carregar os vencimentos" body={error.message} />}

      {!loading && !error && (
        <Panel title="Contratos com vigência a encerrar" padded={false}>
          <Table
            columns={columns}
            rows={items}
            rowKey={(c) => c.id}
            onRowClick={(c) => navigate(`/juridico/contratos/${c.id}`)}
            empty={
              <EmptyState
                title="Nenhum contrato vence nesta janela"
                body="Amplie o período para conferir vencimentos mais distantes."
              />
            }
          />
        </Panel>
      )}
    </div>
  );
}
