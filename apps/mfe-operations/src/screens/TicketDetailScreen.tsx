import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingBar,
  Panel,
  formatDateTime,
} from '@ssm/ui-kit';
import { isAggregateId, useHost, useQuery } from '@ssm/mfe-runtime';
import type { TicketStatus } from '@ssm/contracts';
import { operationsApi } from '../api.js';
import {
  SEVERITY_LABEL,
  SEVERITY_TONE,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  formatDeadline,
} from '../status.js';

/** What an operator can do next, from each state, in their own words. */
const NEXT: Partial<Record<TicketStatus, Array<{ to: TicketStatus; label: string }>>> = {
  open: [{ to: 'in_progress', label: 'Assumir atendimento' }],
  in_progress: [
    { to: 'waiting_customer', label: 'Aguardar cliente' },
    { to: 'resolved', label: 'Resolver' },
  ],
  waiting_customer: [{ to: 'in_progress', label: 'Retomar atendimento' }],
  resolved: [
    { to: 'closed', label: 'Encerrar' },
    { to: 'in_progress', label: 'Reabrir' },
  ],
};

export function TicketDetailScreen() {
  const { id = '' } = useParams();
  const { api, can, notify, setPageTitle, locale } = useHost();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const valid = isAggregateId(id);
  const { data: ticket, loading, error, refetch } = useQuery(
    () =>
      valid
        ? operationsApi.tickets.get(api, id)
        : Promise.reject(new Error('Identificador inválido.')),
    [id, valid],
  );

  useEffect(() => {
    if (ticket) setPageTitle(`#${ticket.number}`, ticket.environmentCode ?? 'SEM AMBIENTE');
  }, [ticket, setPageTitle]);

  async function move(to: TicketStatus) {
    setBusy(true);
    try {
      await operationsApi.tickets.transition(api, id, to);
      notify.success(
        'Estado atualizado',
        to === 'resolved'
          ? 'O tempo de atendimento entra na apuração do mês.'
          : undefined,
      );
      refetch();
    } catch (err) {
      notify.error('Não foi possível alterar o estado', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingBar />;
  if (error || !ticket) {
    return (
      <EmptyState
        title="Chamado não encontrado"
        body={error?.message ?? 'O registro pode ter sido removido.'}
        action={
          <Button variant="secondary" onClick={() => navigate('/operacoes/chamados')}>
            Voltar à fila
          </Button>
        }
      />
    );
  }

  return (
    <div className="ssm-stack">
      <div className="ssm-toolbar">
        <Button variant="ghost" size="sm" onClick={() => navigate('/operacoes/chamados')}>
          ← Chamados
        </Button>
        <Badge tone={SEVERITY_TONE[ticket.severity]}>{SEVERITY_LABEL[ticket.severity]}</Badge>
        <Badge tone={TICKET_STATUS_TONE[ticket.status]} dot>
          {TICKET_STATUS_LABEL[ticket.status]}
        </Badge>
        {ticket.responseBreached && <Badge tone="danger">Prazo descumprido</Badge>}
        <div className="ssm-toolbar__spacer" />
        {can('operations:ticket:update') &&
          NEXT[ticket.status]?.map((action) => (
            <Button
              key={action.to}
              variant={action.to === 'resolved' ? 'primary' : 'secondary'}
              onClick={() => move(action.to)}
              loading={busy}
            >
              {action.label}
            </Button>
          ))}
      </div>

      <div className="ssm-grid-metrics">
        <Card eyebrow="ABERTURA" title={formatDateTime(ticket.openedAt, locale)}>
          {ticket.firstResponseAt
            ? `Primeira resposta em ${formatDateTime(ticket.firstResponseAt, locale)}`
            : 'Ainda sem primeira resposta'}
        </Card>
        <Card eyebrow="PRAZO DE RESPOSTA" title={formatDeadline(ticket.responseDueAt, ticket.firstResponseAt)}>
          Vencia em {formatDateTime(ticket.responseDueAt, locale)}
        </Card>
        <Card eyebrow="AMBIENTE" title={ticket.environmentCode ?? 'Não vinculado'}>
          {ticket.environmentId
            ? 'A indisponibilidade deste chamado entra na apuração do ambiente.'
            : 'Sem ambiente, o chamado não entra na apuração de SLA.'}
        </Card>
        {ticket.pausedMinutes > 0 && (
          <Card eyebrow="PAUSADO" title={`${ticket.pausedMinutes} min`}>
            Tempo aguardando o cliente, descontado do atendimento.
          </Card>
        )}
      </div>

      <Panel title="Descrição">
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', maxWidth: 'var(--container-narrow)' }}>
          {ticket.description || 'Sem descrição.'}
        </p>
      </Panel>

      <Panel title="Linha do tempo">
        <div className="ssm-stack" style={{ gap: 'var(--space-4)' }}>
          {ticket.timeline.map((event, i) => (
            <div key={`${event.at}-${i}`} className="ssm-row" style={{ alignItems: 'flex-start' }}>
              <span
                className="ssm-num"
                style={{ minWidth: 150, color: 'var(--text-muted)', fontSize: 'var(--text-2xs)' }}
              >
                {formatDateTime(event.at, locale)}
              </span>
              <span style={{ fontSize: 'var(--text-sm)' }}>{event.note}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
