import { useEffect } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingBar,
  Metric,
  Panel,
  Table,
  formatDate,
  formatMoney,
  type Column,
} from '@ssm/ui-kit';
import { useHost, useQuery } from '@ssm/mfe-runtime';
import type { SlaPeriod } from '@ssm/contracts';
import { operationsApi } from '../api.js';
import { formatBpsPercent } from '../status.js';

/**
 * The monthly reckoning — where operations meets legal and financial.
 *
 * Read-only here on purpose. Running a reckoning requires
 * `operations:sla:approve` and is done deliberately, because it produces a
 * credit on a customer's invoice and cannot be taken back.
 */
export function SlaScreen() {
  const { api, setPageTitle, locale } = useHost();
  useEffect(() => setPageTitle('SLA', 'OPERAÇÕES'), [setPageTitle]);

  const { data, loading, error, refetch } = useQuery(() => operationsApi.sla.list(api), []);

  const periods = data ?? [];
  const descumpridos = periods.filter((p) => p.breached);
  const creditoTotal = descumpridos.reduce((acc, p) => acc + (p.credit?.amountMinor ?? 0), 0);
  const moeda = descumpridos.find((p) => p.credit)?.credit?.currency ?? 'BRL';

  const columns: Column<SlaPeriod>[] = [
    { key: 'month', header: 'Mês', render: (p) => formatDate(p.month, locale) },
    { key: 'env', header: 'Ambiente', render: (p) => <span className="ssm-num">{p.environmentCode}</span> },
    {
      key: 'achieved',
      header: 'Apurado',
      numeric: true,
      render: (p) => (
        <span style={p.breached ? { color: 'var(--state-danger)' } : undefined}>
          {formatBpsPercent(p.achievedBps)}
        </span>
      ),
    },
    { key: 'target', header: 'Meta', numeric: true, render: (p) => formatBpsPercent(p.targetBps) },
    {
      key: 'downtime',
      header: 'Indisponível',
      numeric: true,
      render: (p) => `${p.downtimeMinutes} min`,
    },
    {
      key: 'status',
      header: 'Resultado',
      render: (p) =>
        p.breached ? (
          <Badge tone="danger" dot>
            Descumprido
          </Badge>
        ) : (
          <Badge tone="success" dot>
            Cumprido
          </Badge>
        ),
    },
    {
      key: 'credit',
      header: 'Crédito',
      numeric: true,
      render: (p) => (p.credit ? formatMoney(p.credit, locale) : '—'),
    },
  ];

  return (
    <div className="ssm-stack">
      <div className="ssm-grid-metrics">
        <Metric label="APURAÇÕES" value={String(periods.length)} />
        <Metric
          label="DESCUMPRIMENTOS"
          value={String(descumpridos.length)}
          tone={descumpridos.length ? 'down' : 'up'}
        />
        <Metric
          label="CRÉDITO DEVIDO"
          value={formatMoney({ amountMinor: creditoTotal, currency: moeda }, locale)}
          delta={creditoTotal ? 'publicado ao financeiro' : 'nada a creditar'}
          tone={creditoTotal ? 'down' : 'up'}
        />
      </div>

      {loading && <LoadingBar />}
      {error && (
        <EmptyState
          title="Não foi possível carregar as apurações"
          body={error.message}
          action={
            <Button variant="secondary" onClick={refetch}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!loading && !error && (
        <Panel title="Apuração mensal de disponibilidade" padded={false}>
          <Table
            columns={columns}
            rows={periods}
            rowKey={(p) => `${p.environmentId}-${p.month}`}
            empty={
              <EmptyState
                title="Nenhum mês apurado"
                body="A apuração é feita por mês e por ambiente, e exige aprovação — o resultado vira crédito na fatura do cliente."
              />
            }
          />
        </Panel>
      )}

      <Card eyebrow="COMO É CALCULADO" title="A indisponibilidade vem dos chamados">
        O tempo fora do ar é derivado dos chamados de severidade 1 do próprio ambiente, não
        digitado: incidentes sobrepostos são contados uma vez só, o tempo aguardando o cliente é
        descontado, e janelas de manutenção agendadas saem da conta. O desconto segue a regra do
        contrato — 5% da mensalidade a cada 0,5% abaixo da meta, limitado a 20%.
      </Card>
    </div>
  );
}
