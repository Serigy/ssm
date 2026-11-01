import type { Clause, Contract, ContractStatus, CreateContract, UpdateContract } from '@ssm/contracts';
import {
  HttpProblem,
  documentPrefix,
  highestNumber,
  withReservedNumber,
  type BaseBindings,
} from '@ssm/worker-common';
import { findContractRow, toDto, type ContractRow } from './queries.js';

/**
 * Ciclo de vida do contrato. `expired -> active` existe porque renovação
 * reativa; `terminated` é final.
 */
const TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['in_review', 'terminated'],
  in_review: ['draft', 'awaiting_signature', 'terminated'],
  awaiting_signature: ['active', 'in_review', 'terminated'],
  active: ['expired', 'terminated'],
  expired: ['active'],
  terminated: [],
};

export const CONTRACT_TRANSITIONS = TRANSITIONS;

/** Depois de assinado o texto é o acordo; alterá-lo é aditivo, não edição. */
const SEALED: ContractStatus[] = ['active', 'expired', 'terminated'];

const now = () => new Date().toISOString();

export async function createContract(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  dto: CreateContract,
): Promise<Contract> {
  const year = new Date().getUTCFullYear();
  const prefix = `${dto.kind.toUpperCase().slice(0, 3)}-${year}-`;
  const seed = await highestNumber(env.DB, 'contracts', 'reference', tenantId, prefix);
  const id = crypto.randomUUID();

  return withReservedNumber(env, tenantId, `contracts:${dto.kind}:${year}`, seed, async (value) => {
    const reference = `${prefix}${String(value).padStart(4, '0')}`;

    // As partes ganham id aqui: o contrato as recebe sem id e elas passam a ser
    // referenciadas por obrigação e por cláusula.
    const parties = dto.parties.map((p) => ({ ...p, id: crypto.randomUUID() }));

    await env.DB.prepare(
      `INSERT INTO contracts (
         id, tenant_id, reference, title, kind, status, parties, governing_law,
         jurisdiction, effective_from, effective_to, renewal_notice_days,
         auto_renew, value_minor, value_currency, tags, current_version,
         created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        id,
        tenantId,
        reference,
        dto.title,
        dto.kind,
        JSON.stringify(parties),
        dto.governingLaw ?? null,
        dto.jurisdiction ?? null,
        dto.effectiveFrom ?? null,
        dto.effectiveTo ?? null,
        dto.renewalNoticeDays ?? 30,
        dto.autoRenew ? 1 : 0,
        dto.value?.amountMinor ?? null,
        dto.value?.currency ?? null,
        JSON.stringify(dto.tags ?? []),
        actorId,
        actorId,
      )
      .run();

    return toDto((await findContractRow(env.DB, tenantId, id))!);
  });
}

export async function updateContract(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  dto: UpdateContract,
): Promise<Contract> {
  const row = await mustFind(env, tenantId, id);
  if (SEALED.includes(row.status as ContractStatus)) {
    throw HttpProblem.conflict(
      `Um contrato "${row.status}" não pode ser editado. Registre um aditivo com POST /:id/amend.`,
    );
  }

  const parties = dto.parties
    ? JSON.stringify(dto.parties.map((p) => ({ ...p, id: crypto.randomUUID() })))
    : row.parties;

  await env.DB.prepare(
    `UPDATE contracts
        SET title = ?, kind = ?, parties = ?, governing_law = ?, jurisdiction = ?,
            effective_from = ?, effective_to = ?, renewal_notice_days = ?,
            auto_renew = ?, value_minor = ?, value_currency = ?, tags = ?,
            updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`,
  )
    .bind(
      dto.title ?? row.title,
      dto.kind ?? row.kind,
      parties,
      dto.governingLaw ?? row.governing_law,
      dto.jurisdiction ?? row.jurisdiction,
      dto.effectiveFrom ?? row.effective_from,
      dto.effectiveTo ?? row.effective_to,
      dto.renewalNoticeDays ?? row.renewal_notice_days,
      dto.autoRenew === undefined ? row.auto_renew : dto.autoRenew ? 1 : 0,
      dto.value?.amountMinor ?? row.value_minor,
      dto.value?.currency ?? row.value_currency,
      dto.tags ? JSON.stringify(dto.tags) : row.tags,
      actorId,
      now(),
      id,
      tenantId,
    )
    .run();

  return toDto(await mustFind(env, tenantId, id));
}

/**
 * Aditivo: a versão corrente vira histórico e o texto novo assume.
 *
 * No MongoDB isto era um `push` num array embutido do próprio documento. Aqui
 * a versão anterior vai para `contract_versions`, que é tabela — e a diferença
 * importa: um contrato com trinta aditivos deixaria o documento crescer sem
 * limite, e no D1 o custo é por linha lida, então carregar o histórico inteiro
 * a cada leitura de contrato seria pago em toda tela de detalhe.
 */
export async function amendContract(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  clauses: Clause[],
  note: string | undefined,
): Promise<Contract> {
  const row = await mustFind(env, tenantId, id);

  const [updated] = await env.DB.batch([
    // A chave primária é (contract_id, version), então a própria tabela recusa
    // duas versões com o mesmo número — o batch inteiro falha antes de o
    // contrato avançar.
    env.DB.prepare(
      `INSERT INTO contract_versions (contract_id, version, created_at, created_by, note, document_key, clauses)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      row.current_version,
      now(),
      actorId,
      note ?? null,
      row.document_key,
      row.clauses,
    ),
    env.DB.prepare(
      `UPDATE contracts
          SET clauses = ?, current_version = current_version + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND current_version = ?`,
    ).bind(JSON.stringify(clauses), actorId, now(), id, tenantId, row.current_version),
  ]);

  // A versão corrente é a condição da escrita: dois aditivos simultâneos não
  // podem virar duas versões com o mesmo número.
  if (!updated || updated.meta.changes === 0) {
    throw HttpProblem.conflict('O contrato recebeu outro aditivo enquanto este era registrado.');
  }

  return toDto(await mustFind(env, tenantId, id));
}

export async function transitionContract(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  to: ContractStatus,
  correlationId: string,
): Promise<Contract> {
  const row = await mustFind(env, tenantId, id);
  const from = row.status as ContractStatus;

  if (!TRANSITIONS[from].includes(to)) {
    throw HttpProblem.conflict(
      `Transição inválida: "${from}" não pode ir para "${to}". ` +
        `Possíveis: ${TRANSITIONS[from].join(', ') || 'nenhuma'}.`,
    );
  }
  if (to === 'active' && !row.effective_from) {
    // O CHECK do banco recusaria; recusar aqui explica o motivo.
    throw HttpProblem.badRequest(
      'Ativar um contrato exige data de início. Preencha effectiveFrom antes.',
    );
  }

  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE contracts SET status = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = ?`,
    ).bind(to, actorId, now(), id, tenantId, from),
    outboxInsert(env, {
      aggregateId: id,
      type: `legal.contract.${to}`,
      tenantId,
      actorId,
      correlationId,
      payload: { contractId: id, reference: row.reference, from, to },
    }),
  ]);

  if (!updated || updated.meta.changes === 0) {
    throw HttpProblem.conflict('A situação do contrato mudou enquanto era alterada.');
  }

  return toDto(await mustFind(env, tenantId, id));
}

export async function attachDocument(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  key: string,
): Promise<Contract> {
  await mustFind(env, tenantId, id);

  // A chave é conferida contra o prefixo do contrato: aceitar qualquer chave
  // deixaria um cliente apontar o contrato para o documento de outro.
  const expected = documentPrefix('contracts', tenantId, id);
  if (!key.startsWith(expected)) {
    throw HttpProblem.badRequest('A chave do documento não pertence a este contrato.');
  }
  // E a existência é conferida no R2: sem isto o contrato aponta para um
  // arquivo que o envio pode nunca ter concluído.
  if (!(await env.R2.head(key))) {
    throw HttpProblem.badRequest('Nenhum arquivo foi encontrado com essa chave. O envio concluiu?');
  }

  await env.DB.prepare(
    'UPDATE contracts SET document_key = ?, updated_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
  )
    .bind(key, actorId, now(), id, tenantId)
    .run();

  return toDto(await mustFind(env, tenantId, id));
}

/**
 * Avisa uma vez por contrato que entra na janela de renovação.
 *
 * A marca `expiry_notice_sent_for` guarda a data de fim para a qual o aviso
 * saiu, e não um booleano: uma renovação que empurra a data rearma o alerta
 * sozinha, sem ninguém lembrar de limpar a marca.
 */
export async function noticeExpiring(env: BaseBindings): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, tenant_id, reference, effective_to,
            CAST(julianday(effective_to) - julianday('now') AS INTEGER) AS days_remaining
       FROM contracts
      WHERE status = 'active'
        AND effective_to IS NOT NULL
        AND effective_to >= date('now')
        AND julianday(effective_to) - julianday('now') <= renewal_notice_days
        AND (expiry_notice_sent_for IS NULL OR expiry_notice_sent_for <> effective_to)
      LIMIT 200`,
  ).all<{
    id: string;
    tenant_id: string;
    reference: string;
    effective_to: string;
    days_remaining: number;
  }>();

  for (const c of results) {
    // A marca e o evento no mesmo batch: gravar a marca sem enfileirar o evento
    // faria o aviso ser perdido para sempre, já que a condição acima deixa de
    // casar na varredura seguinte.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE contracts SET expiry_notice_sent_for = ? WHERE id = ? AND tenant_id = ?`,
      ).bind(c.effective_to, c.id, c.tenant_id),
      outboxInsert(env, {
        aggregateId: c.id,
        type: 'legal.contract.expiring',
        tenantId: c.tenant_id,
        actorId: null,
        correlationId: crypto.randomUUID(),
        payload: {
          contractId: c.id,
          reference: c.reference,
          expiresOn: c.effective_to,
          daysRemaining: c.days_remaining,
        },
      }),
    ]);
  }
  return results.length;
}

async function mustFind(env: BaseBindings, tenantId: string, id: string): Promise<ContractRow> {
  const row = await findContractRow(env.DB, tenantId, id);
  // Mesmo 404 para "não existe" e "é de outro cliente".
  if (!row) throw HttpProblem.notFound(`Contrato ${id} não encontrado.`);
  return row;
}

interface OutboxEvent {
  aggregateId: string;
  type: string;
  tenantId: string;
  actorId: string | null;
  correlationId: string;
  payload: Record<string, unknown>;
}

function outboxInsert(env: BaseBindings, event: OutboxEvent): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload,
                         tenant_id, actor_id, correlation_id)
     VALUES (?, 'contract', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    event.aggregateId,
    event.type,
    JSON.stringify(event.payload),
    event.tenantId,
    event.actorId,
    event.correlationId,
  );
}
