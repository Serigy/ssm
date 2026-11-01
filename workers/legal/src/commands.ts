import type { Clause, Contract, ContractStatus, CreateContract, UpdateContract } from '@ssm/contracts';
import {
  HttpProblem,
  documentPrefix,
  eventStatement,
  highestNumber,
  withReservedNumber,
  type BaseBindings,
  type Database,
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
  db: Database,
  tenantId: string,
  actorId: string,
  dto: CreateContract,
): Promise<Contract> {
  const year = new Date().getUTCFullYear();
  const prefix = `${dto.kind.toUpperCase().slice(0, 3)}-${year}-`;
  const seed = await highestNumber(db, 'contracts', 'reference', tenantId, prefix);
  const id = crypto.randomUUID();

  return withReservedNumber(env, tenantId, `contracts:${dto.kind}:${year}`, seed, async (value) => {
    const reference = `${prefix}${String(value).padStart(4, '0')}`;

    // As partes ganham id aqui: o contrato as recebe sem id e elas passam a ser
    // referenciadas por obrigação e por cláusula.
    const parties = dto.parties.map((p) => ({ ...p, id: crypto.randomUUID() }));

    await db.prepare(
      `INSERT INTO contracts (
         id, tenant_id, reference, title, kind, status, parties, governing_law,
         jurisdiction, effective_from, effective_to, renewal_notice_days,
         auto_renew, value_minor, value_currency, tags, current_version,
         created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, 'draft', ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, 1, ?, ?)`,
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
        dto.autoRenew ?? false,
        dto.value?.amountMinor ?? null,
        dto.value?.currency ?? null,
        JSON.stringify(dto.tags ?? []),
        actorId,
        actorId,
      )
      .run();

    return toDto((await findContractRow(db, tenantId, id))!);
  });
}

export async function updateContract(
  db: Database,
  tenantId: string,
  actorId: string,
  id: string,
  dto: UpdateContract,
): Promise<Contract> {
  const row = await mustFind(db, tenantId, id);
  if (SEALED.includes(row.status as ContractStatus)) {
    throw HttpProblem.conflict(
      `Um contrato "${row.status}" não pode ser editado. Registre um aditivo com POST /:id/amend.`,
    );
  }

  const parties = JSON.stringify(
    dto.parties ? dto.parties.map((p) => ({ ...p, id: crypto.randomUUID() })) : row.parties,
  );

  // `status NOT IN (selados)` na própria condição: se o contrato foi assinado
  // entre a leitura e a escrita, o texto passou a ser o acordo e esta edição
  // não pode mais valer.
  const updated = await db.prepare(
    `UPDATE contracts
        SET title = ?, kind = ?, parties = ?::jsonb, governing_law = ?, jurisdiction = ?,
            effective_from = ?, effective_to = ?, renewal_notice_days = ?,
            auto_renew = ?, value_minor = ?, value_currency = ?, tags = ?::jsonb,
            updated_by = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ? AND status NOT IN ('active','expired','terminated')`,
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
      dto.autoRenew ?? row.auto_renew,
      dto.value?.amountMinor ?? row.value_minor,
      dto.value?.currency ?? row.value_currency,
      JSON.stringify(dto.tags ?? row.tags),
      actorId,
      now(),
      tenantId,
      id,
    )
    .run();
  if (updated.meta.changes === 0) {
    throw HttpProblem.conflict(
      'O contrato foi assinado ou encerrado enquanto era editado. Registre um aditivo.',
    );
  }

  return toDto(await mustFind(db, tenantId, id));
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
  db: Database,
  tenantId: string,
  actorId: string,
  id: string,
  clauses: Clause[],
  note: string | undefined,
): Promise<Contract> {
  const row = await mustFind(db, tenantId, id);

  // Uma transação: o contrato avança e a versão anterior vai para o histórico
  // juntos. O UPDATE vem PRIMEIRO e é o CAS pela versão corrente — dois
  // aditivos simultâneos não podem virar duas versões com o mesmo número, e o
  // perdedor lança antes de gravar histórico (a chave primária
  // (contract_id, version) é a segunda trava). Num `batch()` do D1 o INSERT do
  // histórico vinha antes e o perdedor estourava na chave primária com um 500,
  // em vez do 409.
  await db.transaction(async (tx) => {
    const updated = await tx
      .prepare(
        `UPDATE contracts
            SET clauses = ?::jsonb, current_version = current_version + 1,
                updated_by = ?, updated_at = ?
          WHERE tenant_id = ? AND id = ? AND current_version = ?`,
      )
      .bind(JSON.stringify(clauses), actorId, now(), tenantId, id, row.current_version)
      .run();
    if (updated.meta.changes === 0) {
      throw HttpProblem.conflict('O contrato recebeu outro aditivo enquanto este era registrado.');
    }

    await tx
      .prepare(
        `INSERT INTO contract_versions (contract_id, version, created_at, created_by, note, document_key, clauses)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)`,
      )
      .bind(
        id,
        row.current_version,
        now(),
        actorId,
        note ?? null,
        row.document_key,
        JSON.stringify(row.clauses),
      )
      .run();
  });

  return toDto(await mustFind(db, tenantId, id));
}

export async function transitionContract(
  db: Database,
  tenantId: string,
  actorId: string,
  id: string,
  to: ContractStatus,
  correlationId: string,
): Promise<Contract> {
  const row = await mustFind(db, tenantId, id);
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

  // Mudança de situação e evento num comando só: se outra pessoa mudou a
  // situação entre a leitura e a escrita, o UPDATE não move linha e nenhum
  // evento `legal.contract.<situação>` é gravado.
  const updated = await eventStatement(
    db,
    `moved AS (
       UPDATE contracts SET status = ?, updated_by = ?, updated_at = ?
        WHERE tenant_id = ? AND id = ? AND status = ?
        RETURNING id)`,
    [to, actorId, now(), tenantId, id, from],
    {
      aggregateType: 'contract',
      aggregateId: id,
      type: `legal.contract.${to}`,
      tenantId,
      actorId,
      correlationId,
      payload: { contractId: id, reference: row.reference, from, to },
    },
  ).run();

  if (updated.meta.changes === 0) {
    throw HttpProblem.conflict('A situação do contrato mudou enquanto era alterada.');
  }

  return toDto(await mustFind(db, tenantId, id));
}

export async function attachDocument(
  env: BaseBindings,
  db: Database,
  tenantId: string,
  actorId: string,
  id: string,
  key: string,
): Promise<Contract> {
  await mustFind(db, tenantId, id);

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

  await db
    .prepare(
      'UPDATE contracts SET document_key = ?, updated_by = ?, updated_at = ? WHERE tenant_id = ? AND id = ?',
    )
    .bind(key, actorId, now(), tenantId, id)
    .run();

  return toDto(await mustFind(db, tenantId, id));
}

/**
 * Avisa uma vez por contrato que entra na janela de renovação.
 *
 * A marca `expiry_notice_sent_for` guarda a data de fim para a qual o aviso
 * saiu, e não um booleano: uma renovação que empurra a data rearma o alerta
 * sozinha, sem ninguém lembrar de limpar a marca.
 */
export async function noticeExpiring(db: Database): Promise<number> {
  // Varre todos os tenants de propósito: é a rotina periódica da tabela, sem
  // requisição e sem tenant. Cada escrita abaixo, porém, é escopada por
  // tenant_id e id.
  //
  // `effective_to - current_date` são dias inteiros (date - date). A versão do
  // D1 truncava a diferença de julianday contra o instante atual, e dava um dia
  // a menos conforme a hora da varredura.
  const { results } = await db
    .prepare(
      `SELECT id, tenant_id, reference, effective_to,
              (effective_to - current_date) AS days_remaining
         FROM contracts
        WHERE status = 'active'
          AND effective_to IS NOT NULL
          AND effective_to >= current_date
          AND (effective_to - current_date) <= renewal_notice_days
          AND (expiry_notice_sent_for IS NULL OR expiry_notice_sent_for <> effective_to)
        LIMIT 200`,
    )
    .all<{
      id: string;
      tenant_id: string;
      reference: string;
      effective_to: string;
      days_remaining: number;
    }>();

  let noticed = 0;
  for (const c of results) {
    // A marca e o evento são UM comando: gravar a marca sem enfileirar o evento
    // faria o aviso ser perdido para sempre, já que a condição acima deixa de
    // casar na varredura seguinte. E a marca é condicional — duas varreduras
    // simultâneas não geram dois avisos: quem perde não move linha e não grava
    // evento.
    const sent = await eventStatement(
      db,
      `moved AS (
         UPDATE contracts SET expiry_notice_sent_for = ?
          WHERE tenant_id = ? AND id = ? AND status = 'active'
            AND (expiry_notice_sent_for IS NULL OR expiry_notice_sent_for <> ?)
          RETURNING id)`,
      [c.effective_to, c.tenant_id, c.id, c.effective_to],
      {
        aggregateType: 'contract',
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
      },
    ).run();
    noticed += sent.meta.changes;
  }
  return noticed;
}

async function mustFind(db: Database, tenantId: string, id: string): Promise<ContractRow> {
  const row = await findContractRow(db, tenantId, id);
  // Mesmo 404 para "não existe" e "é de outro cliente".
  if (!row) throw HttpProblem.notFound(`Contrato ${id} não encontrado.`);
  return row;
}
