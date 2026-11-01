import {
  computeTotals,
  isSameCurrency,
  money,
  type CreateInvoice,
  type Invoice,
  type RecordPayment,
  type UpdateInvoice,
} from '@ssm/contracts';
import {
  HttpProblem,
  highestNumber,
  withReservedNumber,
  type BaseBindings,
} from '@ssm/worker-common';
import { findInvoice } from './queries.js';

/**
 * Escrita.
 *
 * Duas coisas que o Postgres dava de graça e aqui precisam ser construídas:
 *
 *   1. **Transação.** O D1 não tem transação interativa — não existe BEGIN,
 *      ler, decidir, escrever, COMMIT. Existe `batch()`, que é atômico mas
 *      precisa ser montado inteiro antes de sair daqui. Toda decisão é tomada
 *      antes; o batch só executa.
 *
 *   2. **Trava de linha.** `SELECT ... FOR UPDATE` não existe. No lugar entra
 *      controle otimista pela coluna `version`: o UPDATE carrega a versão que
 *      foi lida, e se `changes === 0` alguém escreveu no meio do caminho. O
 *      cliente recebe 409 e refaz a leitura. Perde-se a espera pela trava,
 *      ganha-se não segurar nada — que é o que um Worker precisa, já que ele
 *      não tem conexão persistente onde uma trava pudesse viver.
 */

const YEAR_PREFIX = (year: number) => `FAT-${year}-`;

export async function createInvoice(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  dto: CreateInvoice,
): Promise<Invoice> {
  const totals = computeTotals(dto.lines);
  const id = crypto.randomUUID();
  const currency = dto.currency.toUpperCase();

  // Fatura e linhas em um único batch: uma fatura sem as suas linhas tem total
  // que não corresponde a nada, e é exatamente o que um insert parcial deixa.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO invoices (
         id, tenant_id, number, status, counterparty_id, counterparty_name,
         issue_date, due_date, currency, subtotal_minor, tax_total_minor,
         total_minor, amount_paid_minor, notes, document_key,
         created_by, updated_by
       ) VALUES (?, ?, NULL, 'draft', ?, ?, NULL, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`,
    ).bind(
      id,
      tenantId,
      dto.counterpartyId,
      dto.counterpartyName,
      dto.dueDate,
      currency,
      totals.subtotalMinor,
      totals.taxTotalMinor,
      totals.totalMinor,
      dto.notes ?? null,
      actorId,
      actorId,
    ),
    ...dto.lines.map((line, i) =>
      env.DB.prepare(
        `INSERT INTO invoice_lines (
           id, invoice_id, position, description, quantity_milli,
           unit_price_minor, tax_rate_bps, line_total_minor
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        id,
        i,
        line.description,
        line.quantityMilli,
        line.unitPrice.amountMinor,
        line.taxRateBps ?? 0,
        totals.lines[i]!.lineTotalMinor,
      ),
    ),
  ]);

  const created = await findInvoice(env.DB, tenantId, id);
  if (!created) throw new Error(`Fatura ${id} desapareceu logo após ser criada.`);
  return created;
}

export async function issueInvoice(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  correlationId: string,
): Promise<Invoice> {
  const current = await readForUpdate(env, tenantId, id);
  if (current.status !== 'draft') {
    throw HttpProblem.conflict(
      `Uma fatura em ${current.status} não pode ser emitida; só um rascunho pode.`,
    );
  }
  if (current.invoice.lines.length === 0) {
    throw HttpProblem.badRequest('Uma fatura sem itens não pode ser emitida.');
  }

  const year = new Date().getUTCFullYear();
  const prefix = YEAR_PREFIX(year);
  const seed = await highestNumber(env.DB, 'invoices', 'number', tenantId, prefix);

  // O número só é confirmado se a gravação vencer; se ela perder, ele volta
  // para a fila. Ver withReservedNumber — a versão sem esse cuidado abria
  // lacuna a cada emissão concorrente perdida.
  return withReservedNumber(env, tenantId, `invoices:${year}`, seed, async (value) => {
    const number = `${prefix}${String(value).padStart(5, '0')}`;
    const issueDate = new Date().toISOString().slice(0, 10);

    const [updated] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE invoices
            SET number = ?, status = 'issued', issue_date = ?,
                version = version + 1, updated_by = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ? AND tenant_id = ? AND version = ? AND status = 'draft'`,
      ).bind(number, issueDate, actorId, id, tenantId, current.version),
      outboxInsert(env, {
        aggregateId: id,
        type: 'financial.invoice.issued',
        tenantId,
        actorId,
        correlationId,
        payload: {
          invoiceId: id,
          number,
          counterpartyId: current.invoice.counterpartyId,
          total: money(current.invoice.total.amountMinor, current.invoice.currency),
          dueDate: current.invoice.dueDate,
        },
      }),
    ]);

    // `changes === 0` significa que a versão mudou entre a leitura e a escrita.
    // O batch é atômico, então o evento do outbox foi desfeito junto; lançar
    // aqui devolve o número também.
    assertWon(updated, 'A fatura foi alterada por outra pessoa enquanto era emitida.');

    return (await findInvoice(env.DB, tenantId, id))!;
  });
}

/**
 * Cancela a fatura, mantendo registro e número no histórico.
 *
 * Cancelar e não excluir: o que já foi emitido é rastro de auditoria, e apagar
 * deixaria lacuna na sequência — que é exatamente o que um fiscal procura.
 */
export async function voidInvoice(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  reason: string,
  correlationId: string,
): Promise<Invoice> {
  const current = await readForUpdate(env, tenantId, id);
  if (current.status === 'void') {
    throw HttpProblem.conflict('Esta fatura já está cancelada.');
  }
  if (current.status === 'paid') {
    throw HttpProblem.conflict(
      'Uma fatura paga não pode ser cancelada. Registre uma nota de crédito.',
    );
  }
  if (current.status === 'draft') {
    // A máquina de estados do serviço em NestJS permitia draft -> void, e o
    // CHECK do banco recusava: só um rascunho pode estar sem número, então
    // cancelar um rascunho o tira de `draft` sem lhe dar número e a linha vira
    // ilegal. Dava 500 no Postgres pelo mesmo motivo, e ninguém tinha passado
    // por ali. Cancelar existe para preservar número no histórico — um rascunho
    // não tem número a preservar, então o que se faz com ele é excluir.
    throw HttpProblem.conflict(
      'Um rascunho não é cancelado, é excluído. Cancelar existe para manter no ' +
        'histórico o número de uma fatura já emitida.',
    );
  }

  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE invoices
          SET status = 'void', version = version + 1, updated_by = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND tenant_id = ? AND version = ?`,
    ).bind(actorId, id, tenantId, current.version),
    outboxInsert(env, {
      aggregateId: id,
      type: 'financial.invoice.voided',
      tenantId,
      actorId,
      correlationId,
      payload: { invoiceId: id, number: current.invoice.number, reason },
    }),
  ]);

  assertWon(updated, 'A fatura foi alterada por outra pessoa enquanto era cancelada.');
  return (await findInvoice(env.DB, tenantId, id))!;
}

export async function deleteDraft(
  env: BaseBindings,
  tenantId: string,
  id: string,
): Promise<void> {
  const current = await readForUpdate(env, tenantId, id);
  if (current.status !== 'draft') {
    throw HttpProblem.conflict(
      'Somente rascunhos podem ser excluídos. Cancele a fatura para mantê-la no histórico.',
    );
  }
  // As linhas somem por ON DELETE CASCADE, declarado na migração.
  await env.DB.prepare('DELETE FROM invoices WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .run();
}

export async function updateInvoice(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  dto: UpdateInvoice,
): Promise<Invoice> {
  const current = await readForUpdate(env, tenantId, id);
  if (current.status !== 'draft') {
    throw HttpProblem.conflict(
      'Somente um rascunho pode ser editado. Uma fatura emitida é cancelada e refeita.',
    );
  }

  const lines = dto.lines ?? current.invoice.lines;
  const totals = computeTotals(lines);
  const currency = (dto.currency ?? current.invoice.currency).toUpperCase();

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE invoices
          SET counterparty_id = ?, counterparty_name = ?, due_date = ?, currency = ?,
              subtotal_minor = ?, tax_total_minor = ?, total_minor = ?, notes = ?,
              version = version + 1, updated_by = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND tenant_id = ? AND version = ? AND status = 'draft'`,
    ).bind(
      dto.counterpartyId ?? current.invoice.counterpartyId,
      dto.counterpartyName ?? current.invoice.counterpartyName,
      dto.dueDate ?? current.invoice.dueDate,
      currency,
      totals.subtotalMinor,
      totals.taxTotalMinor,
      totals.totalMinor,
      dto.notes ?? current.invoice.notes ?? null,
      actorId,
      id,
      tenantId,
      current.version,
    ),
  ];

  // As linhas são substituídas por inteiro quando vêm no corpo. Atualizar item
  // a item exigiria identidade estável de linha, que o formulário não tem — e
  // um casamento por posição erraria assim que alguém reordenasse.
  if (dto.lines) {
    statements.push(env.DB.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').bind(id));
    dto.lines.forEach((line, i) => {
      statements.push(
        env.DB.prepare(
          `INSERT INTO invoice_lines (
             id, invoice_id, position, description, quantity_milli,
             unit_price_minor, tax_rate_bps, line_total_minor
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          id,
          i,
          line.description,
          line.quantityMilli,
          line.unitPrice.amountMinor,
          line.taxRateBps ?? 0,
          totals.lines[i]!.lineTotalMinor,
        ),
      );
    });
  }

  const [updated] = await env.DB.batch(statements);
  assertWon(updated, 'A fatura foi alterada por outra pessoa enquanto era editada.');
  return (await findInvoice(env.DB, tenantId, id))!;
}

export async function recordPayment(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  dto: RecordPayment,
  correlationId: string,
): Promise<Invoice> {
  const current = await readForUpdate(env, tenantId, id);
  const invoice = current.invoice;

  if (!isSameCurrency(dto.amount, invoice.currency)) {
    throw HttpProblem.badRequest(
      `Moeda divergente: o pagamento está em ${dto.amount.currency} e a fatura em ` +
        `${invoice.currency}. Registre o pagamento na moeda da fatura.`,
    );
  }
  if (current.status !== 'issued' && current.status !== 'partially_paid') {
    throw HttpProblem.conflict(
      `Não é possível registrar pagamento em uma fatura em ${current.status}.`,
    );
  }
  if (dto.amount.amountMinor <= 0) {
    throw HttpProblem.badRequest('O valor do pagamento deve ser positivo.');
  }

  const paid = invoice.amountPaid.amountMinor + dto.amount.amountMinor;
  if (paid > invoice.total.amountMinor) {
    // O CHECK do banco recusaria isso de qualquer forma; recusar aqui devolve
    // 400 com explicação em vez de 500 vindo do SQLite.
    throw HttpProblem.badRequest(
      `O pagamento excede o saldo em aberto da fatura ` +
        `(${invoice.total.amountMinor - invoice.amountPaid.amountMinor} restantes).`,
    );
  }

  const status = paid === invoice.total.amountMinor ? 'paid' : 'partially_paid';

  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE invoices
          SET amount_paid_minor = ?, status = ?, version = version + 1, updated_by = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND tenant_id = ? AND version = ?`,
    ).bind(paid, status, actorId, id, tenantId, current.version),
    outboxInsert(env, {
      aggregateId: id,
      type: status === 'paid' ? 'financial.invoice.paid' : 'financial.invoice.partially_paid',
      tenantId,
      actorId,
      correlationId,
      payload: {
        invoiceId: id,
        number: invoice.number,
        amount: dto.amount,
        amountPaid: money(paid, invoice.currency),
        paidAt: dto.paidAt,
        reference: dto.reference ?? null,
      },
    }),
  ]);

  assertWon(updated, 'A fatura foi alterada por outra pessoa enquanto o pagamento era registrado.');

  return (await findInvoice(env.DB, tenantId, id))!;
}

// --- apoio -----------------------------------------------------------------

/**
 * Lê o estado e a versão que o UPDATE vai exigir.
 *
 * O nome mantém a intenção do `lockOne` do serviço em NestJS, mas aqui nada é
 * travado: o que se leva da leitura é a versão, e ela é a condição da escrita.
 */
async function readForUpdate(
  env: BaseBindings,
  tenantId: string,
  id: string,
): Promise<{ invoice: Invoice; version: number; status: Invoice['status'] }> {
  const row = await env.DB.prepare(
    'SELECT version, status FROM invoices WHERE id = ? AND tenant_id = ?',
  )
    .bind(id, tenantId)
    .first<{ version: number; status: string }>();
  // Mesmo 404 de "não existe" e "é de outro cliente", como na leitura.
  if (!row) throw HttpProblem.notFound(`Fatura ${id} não encontrada.`);

  const invoice = await findInvoice(env.DB, tenantId, id);
  if (!invoice) throw HttpProblem.notFound(`Fatura ${id} não encontrada.`);

  return { invoice, version: row.version, status: row.status as Invoice['status'] };
}

function assertWon(result: D1Result | undefined, message: string): void {
  if (!result || result.meta.changes === 0) throw HttpProblem.conflict(message);
}

interface OutboxEvent {
  aggregateId: string;
  type: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

/**
 * O outbox continua sendo o motivo de o evento não ser publicado aqui.
 *
 * Publicar na Queue direto significaria escolher entre publicar antes de gravar
 * (evento de algo que pode não ter acontecido) ou depois (estado alterado sem
 * ninguém saber). A linha do outbox entra no mesmo `batch()` da mudança de
 * estado, e o Cron Trigger publica depois.
 */
function outboxInsert(env: BaseBindings, event: OutboxEvent): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload,
                         tenant_id, actor_id, correlation_id)
     VALUES (?, 'invoice', ?, ?, ?, ?, ?, ?)`,
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
