import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingBar,
  Panel,
  Tabs,
  Tag,
  formatDate,
  formatMoney,
} from '@ssm/ui-kit';
import { isAggregateId, useHost, useQuery } from '@ssm/mfe-runtime';
import type { Clause, ContractStatus } from '@ssm/contracts';
import { legalApi } from '../api.js';
import { KIND_LABEL, RISK_LABEL, RISK_TONE, STATUS_LABEL, STATUS_TONE, daysUntil } from '../status.js';

/** The transitions a user can trigger from each state, with their button copy. */
const NEXT_ACTIONS: Partial<Record<ContractStatus, Array<{ to: ContractStatus; label: string }>>> = {
  draft: [{ to: 'in_review', label: 'Enviar para revisão' }],
  in_review: [
    { to: 'awaiting_signature', label: 'Liberar para assinatura' },
    { to: 'draft', label: 'Devolver ao rascunho' },
  ],
  awaiting_signature: [{ to: 'active', label: 'Registrar assinatura' }],
  active: [{ to: 'terminated', label: 'Encerrar contrato' }],
};

export function ContractDetailScreen() {
  const { id = '' } = useParams();
  const { api, can, notify, setPageTitle, locale } = useHost();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState('clauses');
  const [busy, setBusy] = useState(false);

  const valid = isAggregateId(id);
  const { data: contract, loading, error, refetch } = useQuery(
    () => (valid ? legalApi.get(api, id) : Promise.reject(new Error('Identificador inválido.'))),
    [id, valid],
  );

  useEffect(() => {
    if (contract) setPageTitle(contract.reference, contract.title);
  }, [contract, setPageTitle]);

  async function transition(to: ContractStatus) {
    setBusy(true);
    try {
      await legalApi.transition(api, id, to);
      notify.success(
        'Situação atualizada',
        to === 'active' ? 'O financeiro foi notificado da vigência.' : undefined,
      );
      refetch();
    } catch (err) {
      notify.error('Não foi possível alterar a situação', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    try {
      await legalApi.upload(api, id, file);
      notify.success('Documento anexado', file.name);
      refetch();
    } catch (err) {
      notify.error('O envio falhou', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingBar />;
  if (error || !contract) {
    return (
      <EmptyState
        title="Contrato não encontrado"
        body={error?.message ?? 'O registro pode ter sido removido.'}
        action={
          <Button variant="secondary" onClick={() => navigate('/juridico/contratos')}>
            Voltar à lista
          </Button>
        }
      />
    );
  }

  const remaining = daysUntil(contract.effectiveTo);

  return (
    <div className="ssm-stack">
      <div className="ssm-toolbar">
        <Button variant="ghost" size="sm" onClick={() => navigate('/juridico/contratos')}>
          ← Contratos
        </Button>
        <Badge tone={STATUS_TONE[contract.status]} dot>
          {STATUS_LABEL[contract.status]}
        </Badge>
        {contract.risk && (
          <Badge tone={RISK_TONE[contract.risk] ?? 'neutral'}>
            Risco {RISK_LABEL[contract.risk] ?? contract.risk}
          </Badge>
        )}
        <div className="ssm-toolbar__spacer" />

        {can('legal:contract:update') && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = '';
              }}
            />
            <Button variant="secondary" onClick={() => fileInput.current?.click()} loading={busy}>
              {contract.documentKey ? 'Substituir PDF' : 'Anexar PDF'}
            </Button>
          </>
        )}

        {contract.documentKey && (
          <Button
            variant="secondary"
            onClick={async () => {
              const ticket = await legalApi.documentUrl(api, id);
              window.open(ticket.url, '_blank', 'noopener');
            }}
          >
            Abrir PDF
          </Button>
        )}

        {can('legal:contract:approve') &&
          NEXT_ACTIONS[contract.status]?.map((action) => (
            <Button key={action.to} onClick={() => transition(action.to)} loading={busy}>
              {action.label}
            </Button>
          ))}
      </div>

      <div className="ssm-grid-metrics">
        <Card eyebrow="TIPO" title={KIND_LABEL[contract.kind] ?? contract.kind}>
          Versão {contract.currentVersion} · {contract.clauses.length} cláusula(s)
        </Card>
        <Card eyebrow="VIGÊNCIA" title={formatDate(contract.effectiveFrom, locale)}>
          {contract.effectiveTo
            ? `Até ${formatDate(contract.effectiveTo, locale)}${remaining !== null ? ` · ${remaining} dias` : ''}`
            : 'Prazo indeterminado'}
        </Card>
        <Card eyebrow="VALOR" title={formatMoney(contract.value, locale)}>
          {contract.autoRenew ? 'Renovação automática' : 'Renovação manual'} · aviso{' '}
          {contract.renewalNoticeDays} dias
        </Card>
        <Card eyebrow="FORO" title={contract.jurisdiction ?? 'Não informado'}>
          Lei aplicável: {contract.governingLaw ?? 'não informada'}
        </Card>
      </div>

      {contract.tags.length > 0 && (
        <div className="ssm-row" style={{ flexWrap: 'wrap' }}>
          {contract.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}

      <Tabs
        items={[
          { value: 'clauses', label: 'Cláusulas', count: contract.clauses.length },
          { value: 'obligations', label: 'Obrigações', count: contract.obligations.length },
          { value: 'parties', label: 'Partes', count: contract.parties.length },
        ]}
        value={tab}
        onChange={setTab}
        aria-label="Seções do contrato"
      />

      {tab === 'clauses' && (
        <Panel title="Árvore de cláusulas">
          {contract.clauses.length ? (
            <ClauseTree clauses={contract.clauses} />
          ) : (
            <EmptyState
              title="Sem cláusulas registradas"
              body="Envie o PDF e registre as cláusulas por um aditivo para habilitar a análise de risco e as obrigações."
            />
          )}
        </Panel>
      )}

      {tab === 'obligations' && (
        <Panel title="Obrigações">
          {contract.obligations.length ? (
            <div className="ssm-stack" style={{ gap: 'var(--space-3)' }}>
              {contract.obligations.map((o) => (
                <div key={o.id} className="ssm-row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 'var(--text-sm)' }}>{o.description}</span>
                  <div className="ssm-row">
                    <Badge tone={o.owner === 'us' ? 'brand' : 'neutral'}>
                      {o.owner === 'us' ? 'Nossa' : 'Contraparte'}
                    </Badge>
                    <Badge tone={o.fulfilled ? 'success' : 'warning'} dot>
                      {o.fulfilled ? 'Cumprida' : 'Pendente'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhuma obrigação extraída"
              body="As obrigações são derivadas das cláusulas registradas."
            />
          )}
        </Panel>
      )}

      {tab === 'parties' && (
        <Panel title="Partes">
          <div className="ssm-stack" style={{ gap: 'var(--space-3)' }}>
            {contract.parties.map((p) => (
              <div key={p.id} className="ssm-row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)' }}>{p.name}</span>
                <Badge tone={p.role === 'first_party' ? 'brand' : 'neutral'}>{p.role}</Badge>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/** Renders the recursive clause tree with its own indentation, no library. */
function ClauseTree({ clauses, depth = 0 }: { clauses: Clause[]; depth?: number }) {
  return (
    <div className="ssm-stack" style={{ gap: 'var(--space-4)' }}>
      {clauses.map((clause) => (
        <div
          key={clause.id}
          style={{
            paddingLeft: depth * 20,
            borderLeft: depth > 0 ? '1px solid var(--border-subtle)' : undefined,
          }}
        >
          <div className="ssm-row" style={{ gap: 'var(--space-3)' }}>
            <span className="ssm-num" style={{ color: 'var(--text-brand)' }}>
              {clause.ordinal}
            </span>
            <strong style={{ fontSize: 'var(--text-sm)' }}>{clause.heading}</strong>
            {clause.risk && (
              <Badge tone={RISK_TONE[clause.risk] ?? 'neutral'}>{RISK_LABEL[clause.risk]}</Badge>
            )}
          </div>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              lineHeight: 'var(--leading-relaxed)',
              maxWidth: 'var(--container-narrow)',
              margin: 'var(--space-2) 0 0',
            }}
          >
            {clause.body}
          </p>
          {clause.children.length > 0 && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <ClauseTree clauses={clause.children} depth={depth + 1} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
