import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  LoadingBar,
  Panel,
  Table,
  formatBps,
  formatDate,
  formatMoney,
  formatQuantity,
  type Column,
} from '@ssm/ui-kit';
import { isAggregateId, useHost, useQuery } from '@ssm/mfe-runtime';
import type { InvoiceLine } from '@ssm/contracts';
import { financialApi } from '../api.js';
import { STATUS_LABEL, STATUS_TONE } from '../status.js';

export function InvoiceDetailScreen() {
  const { id = '' } = useParams();
  const { api, can, notify, setPageTitle, locale } = useHost();
  const navigate = useNavigate();

  const [confirmIssue, setConfirmIssue] = useState(false);
  const [voidReason, setVoidReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Guarded so a path that is not an id never becomes a request. The screen
  // renders its own "não encontrada" instead of surfacing a 400.
  const valid = isAggregateId(id);
  const { data: invoice, loading, error, refetch } = useQuery(
    () => (valid ? financialApi.get(api, id) : Promise.reject(new Error('Identificador inválido.'))),
    [id, valid],
  );

  useEffect(() => {
    if (invoice) setPageTitle(invoice.number ?? 'Rascunho de fatura', invoice.counterpartyName);
  }, [invoice, setPageTitle]);

  async function issue() {
    setBusy(true);
    try {
      const updated = await financialApi.issue(api, id);
      notify.success('Fatura emitida', `Número ${updated.number} atribuído.`);
      setConfirmIssue(false);
      refetch();
    } catch (err) {
      notify.error('Não foi possível emitir', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function voidInvoice() {
    if (!voidReason?.trim()) return;
    setBusy(true);
    try {
      await financialApi.void(api, id, voidReason);
      notify.success('Fatura cancelada', 'O registro permanece no histórico.');
      setVoidReason(null);
      refetch();
    } catch (err) {
      notify.error('Não foi possível cancelar', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingBar />;
  if (error || !invoice) {
    return (
      <EmptyState
        title="Fatura não encontrada"
        body={error?.message ?? 'O registro pode ter sido removido.'}
        action={
          <Button variant="secondary" onClick={() => navigate('/financeiro/faturas')}>
            Voltar à lista
          </Button>
        }
      />
    );
  }

  const columns: Column<InvoiceLine>[] = [
    { key: 'desc', header: 'Descrição', render: (l) => l.description },
    {
      key: 'qty',
      header: 'Qtd.',
      numeric: true,
      render: (l) => formatQuantity(l.quantityMilli, locale),
    },
    {
      key: 'unit',
      header: 'Preço unit.',
      numeric: true,
      render: (l) => formatMoney(l.unitPrice, locale),
    },
    { key: 'tax', header: 'Imposto', numeric: true, render: (l) => formatBps(l.taxRateBps) },
    {
      key: 'total',
      header: 'Total',
      numeric: true,
      render: (l) => formatMoney(l.lineTotal, locale),
    },
  ];

  const balance = {
    amountMinor: invoice.total.amountMinor - invoice.amountPaid.amountMinor,
    currency: invoice.currency,
  };

  return (
    <div className="ssm-stack">
      <div className="ssm-toolbar">
        <Button variant="ghost" size="sm" onClick={() => navigate('/financeiro/faturas')}>
          ← Faturas
        </Button>
        <Badge tone={STATUS_TONE[invoice.status]} dot>
          {STATUS_LABEL[invoice.status]}
        </Badge>
        <div className="ssm-toolbar__spacer" />

        {invoice.status === 'draft' && can('financial:invoice:approve') && (
          <Button onClick={() => setConfirmIssue(true)}>Emitir fatura</Button>
        )}
        {(invoice.status === 'issued' || invoice.status === 'partially_paid') &&
          can('financial:invoice:approve') && (
            <Button variant="secondary" onClick={() => setVoidReason('')}>
              Cancelar fatura
            </Button>
          )}
        {invoice.documentKey && (
          <Button
            variant="secondary"
            onClick={async () => {
              const ticket = await financialApi.documentUrl(api, id);
              window.open(ticket.url, '_blank', 'noopener');
            }}
          >
            Abrir PDF
          </Button>
        )}
      </div>

      <div className="ssm-grid-metrics">
        <Card eyebrow="EMISSÃO" title={formatDate(invoice.issueDate, locale)}>
          Vencimento em {formatDate(invoice.dueDate, locale)}
        </Card>
        <Card eyebrow="TOTAL" title={formatMoney(invoice.total, locale)}>
          Subtotal {formatMoney(invoice.subtotal, locale)} · impostos{' '}
          {formatMoney(invoice.taxTotal, locale)}
        </Card>
        <Card eyebrow="EM ABERTO" title={formatMoney(balance, locale)}>
          Recebido {formatMoney(invoice.amountPaid, locale)}
        </Card>
      </div>

      <Panel title="Itens" padded={false}>
        <Table columns={columns} rows={invoice.lines} rowKey={(l) => l.id} />
      </Panel>

      {invoice.notes && (
        <Card eyebrow="OBSERVAÇÕES" title="Notas internas">
          {invoice.notes}
        </Card>
      )}

      <Dialog
        open={confirmIssue}
        title="Emitir esta fatura?"
        description={
          'A emissão atribui o número sequencial do exercício e congela os valores. ' +
          'Não pode ser desfeita — uma fatura emitida só pode ser cancelada, e o número ' +
          'permanece no histórico.'
        }
        onClose={() => setConfirmIssue(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmIssue(false)}>
              Voltar
            </Button>
            <Button onClick={issue} loading={busy}>
              Emitir fatura
            </Button>
          </>
        }
      />

      <Dialog
        open={voidReason !== null}
        title="Cancelar esta fatura?"
        description="O registro e o número permanecem no histórico. Informe o motivo do cancelamento."
        onClose={() => setVoidReason(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setVoidReason(null)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              onClick={voidInvoice}
              loading={busy}
              disabled={!voidReason?.trim()}
            >
              Cancelar fatura
            </Button>
          </>
        }
      >
        <Input
          label="Motivo"
          required
          value={voidReason ?? ''}
          onChange={(e) => setVoidReason(e.target.value)}
          hint="Fica registrado no evento financial.invoice.voided."
        />
      </Dialog>
    </div>
  );
}
