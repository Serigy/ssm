import {
  createApp,
  requireAuth,
  requirePermissions,
  HttpProblem,
  Coordinator,
  idempotent,
  downloadTicket,
  type AppEnv,
  captureUnexpected,
  withMonitoring,
  openFromBinding,
  type Database,
} from '@ssm/worker-common';
import { z } from 'zod';
import {
  createInvoiceSchema,
  invoiceFilterSchema,
  pageQuerySchema,
  recordPaymentSchema,
  updateInvoiceSchema,
  type Invoice,
  type Page,
} from '@ssm/contracts';
import { listInvoices, findInvoice } from './queries.js';
import {
  createInvoice,
  deleteDraft,
  issueInvoice,
  recordPayment,
  updateInvoice,
  voidInvoice,
} from './commands.js';

// Financeiro já está no Neon (ADR 0014): `postgres` abre a conexão da requisição.
const app = createApp('/api/financial', { postgres: true });

app.get(
  '/api/financial/v1/invoices',
  requireAuth(),
  requirePermissions('financial:invoice:read'),
  async (c) => {
    const { limit, cursor, sort, ...filter } = parse(
      invoiceFilterSchema.merge(pageQuerySchema),
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    const page: Page<Invoice> = await listInvoices(c.get('db'), c.get('actor').tenantId, filter, {
      limit,
      cursor,
      sort,
    });
    return c.json(page);
  },
);

app.get(
  '/api/financial/v1/invoices/:id',
  requireAuth(),
  requirePermissions('financial:invoice:read'),
  async (c) => {
    const invoice = await findInvoice(c.get('db'), c.get('actor').tenantId, c.req.param('id'));
    // Mesmo 404 para "não existe" e "é de outro cliente": um 403 confirmaria
    // que o id é real a quem não deveria saber.
    if (!invoice) throw HttpProblem.notFound(`Fatura ${c.req.param('id')} não encontrada.`);
    return c.json(invoice);
  },
);

// --- comandos --------------------------------------------------------------

/**
 * Criar rascunho. Sem idempotência, como no controller em NestJS: criar um
 * rascunho duas vezes é desarrumado, não é dano. Emitir e pagar duas vezes é.
 */
app.post(
  '/api/financial/v1/invoices',
  requireAuth(),
  requirePermissions('financial:invoice:create'),
  async (c) => {
    const dto = parse(createInvoiceSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    const invoice = await createInvoice(c.get('db'), actor.tenantId, actor.id, dto);
    c.header('Location', `/api/financial/v1/invoices/${invoice.id}`);
    return c.json(invoice, 201);
  },
);

app.post(
  '/api/financial/v1/invoices/:id/issue',
  requireAuth(),
  requirePermissions('financial:invoice:approve'),
  idempotent(),
  async (c) => {
    const actor = c.get('actor');
    return c.json(
      await issueInvoice(c.env, c.get('db'), actor.tenantId, actor.id, c.req.param('id'), c.get('traceId')),
    );
  },
);

app.post(
  '/api/financial/v1/invoices/:id/payments',
  requireAuth(),
  requirePermissions('financial:invoice:update'),
  idempotent(),
  async (c) => {
    const dto = parse(recordPaymentSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    return c.json(
      await recordPayment(
        c.get('db'),
        actor.tenantId,
        actor.id,
        c.req.param('id'),
        dto,
        c.get('traceId'),
      ),
    );
  },
);

app.patch(
  '/api/financial/v1/invoices/:id',
  requireAuth(),
  requirePermissions('financial:invoice:update'),
  async (c) => {
    const dto = parse(updateInvoiceSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    return c.json(await updateInvoice(c.get('db'), actor.tenantId, actor.id, c.req.param('id'), dto));
  },
);

app.post(
  '/api/financial/v1/invoices/:id/void',
  requireAuth(),
  requirePermissions('financial:invoice:approve'),
  idempotent(),
  async (c) => {
    const body = parse(
      z.object({ reason: z.string().min(1).max(500) }),
      await c.req.json().catch(() => null),
    );
    const actor = c.get('actor');
    return c.json(
      await voidInvoice(
        c.get('db'),
        actor.tenantId,
        actor.id,
        c.req.param('id'),
        body.reason,
        c.get('traceId'),
      ),
    );
  },
);

app.delete(
  '/api/financial/v1/invoices/:id',
  requireAuth(),
  requirePermissions('financial:invoice:delete'),
  async (c) => {
    await deleteDraft(c.get('db'), c.get('actor').tenantId, c.req.param('id'));
    return c.body(null, 204);
  },
);

/**
 * Link temporário para o PDF.
 *
 * A revogação é conferida aqui, embora seja um GET: a URL assinada sobrevive à
 * requisição e funciona sem token nenhum. Uma sessão encerrada não pode sair
 * levando uma.
 */
app.get(
  '/api/financial/v1/invoices/:id/document',
  requireAuth(),
  requirePermissions('financial:invoice:read'),
  async (c) => {
    const actor = c.get('actor');
    const [tokenHit, watermark] = await Promise.all([
      c.env.KV.get(`revoked:jti:${actor.claims.jti}`),
      c.env.KV.get(`revoked:user:${actor.id}`),
    ]);
    if (tokenHit || (watermark && actor.claims.iat <= Number(watermark))) {
      throw HttpProblem.unauthorized('Esta sessão foi revogada. Entre novamente.');
    }

    const invoice = await findInvoice(c.get('db'), actor.tenantId, c.req.param('id'));
    if (!invoice) throw HttpProblem.notFound(`Fatura ${c.req.param('id')} não encontrada.`);
    if (!invoice.documentKey) {
      throw HttpProblem.notFound('Esta fatura ainda não tem documento gerado.');
    }
    return c.json(await downloadTicket(c.env, invoice.documentKey));
  },
);

/**
 * Erro de validação em problem+json, com o caminho do campo — como o
 * ZodValidationPipe fazia.
 *
 * O genérico é o schema, não o tipo: os schemas usam `.default()`, e o tipo de
 * saída tem campos que o de entrada não tem. Amarrar em `z.ZodType<T>` faz o
 * TypeScript igualar os dois e o `taxRateBps` opcional deixa de casar com o
 * obrigatório que `computeTotals` recebe.
 */
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw HttpProblem.badRequest(
      result.error.issues.map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return result.data;
}

export interface QueueEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tenantId: string;
  correlationId: string;
}

export default withMonitoring({
  fetch: app.fetch,

  /**
   * O financeiro é o módulo que mais escuta.
   *
   * Ele precisa saber quando alguém sai da empresa, para as cobranças
   * recorrentes ligadas àquela pessoa pararem; quando um contrato entra em
   * vigor, para o cronograma de faturamento existir; e quando um mês descumpriu
   * o SLA, porque aí a empresa deve dinheiro ao cliente. Aprende as três
   * escutando — nunca chamando os outros módulos, que faria emitir fatura
   * falhar sempre que o RH estivesse fora.
   */
  async queue(batch: MessageBatch<QueueEvent>, env: AppEnv['Bindings']) {
    // Uma conexão para o lote inteiro, fechada ao fim — o consumidor não passa
    // pelo Hono, então ninguém mais a fecharia.
    const db = openFromBinding(env.HYPERDRIVE);
    try {
      for (const message of batch.messages) {
        try {
          await handleEvent(db, message.body);
          message.ack();
        } catch (err) {
          console.error(
            JSON.stringify({
              event: 'financial.queue.failed',
              id: message.body?.id,
              type: message.body?.type,
              err: String(err),
            }),
          );
          captureUnexpected(err, message.body?.correlationId ?? message.id);
          message.retry();
        }
      }
    } finally {
      await db.close();
    }
  },

  /**
   * Relay do outbox.
   *
   * O Cron Trigger tem granularidade de um minuto, contra o intervalo de um
   * segundo do relay em contêiner. A latência entre módulos passa de ~1 s para
   * até 60 s — é a perda desta migração, e ela é aceitável porque nenhum fluxo
   * entre módulos do SSM é síncrono do ponto de vista de quem usa: o financeiro
   * saber de um desligamento um minuto depois não muda nada para ninguém.
   */
  async scheduled(_controller: ScheduledController, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    const db = openFromBinding(env.HYPERDRIVE);
    ctx.waitUntil(drainOutbox(env, db).finally(() => db.close()));
  },
} satisfies ExportedHandler<AppEnv['Bindings'], QueueEvent>);

/**
 * O consumo é idempotente porque a entrega é ao-menos-uma-vez.
 *
 * A marca em processed_events e o EFEITO do evento são a mesma transação. A
 * trava é a chave primária (`ON CONFLICT DO NOTHING`): quem consegue inserir
 * processa, quem não consegue já foi processado. E se o efeito lança, a marca
 * é desfeita junto — a reentrega (`message.retry()`) processa de novo, em vez
 * de encontrar o evento "já processado" e perder o efeito para sempre. Marcar
 * antes e executar depois, como era no D1, tinha exatamente esse buraco.
 *
 * Devolve 'duplicate' quando o evento já tinha sido aplicado.
 */
export async function handleEvent(
  db: Database,
  event: QueueEvent,
  effect: (tx: Database, event: QueueEvent) => Promise<void> = applyEffect,
): Promise<'processed' | 'duplicate'> {
  return db.transaction(async (tx) => {
    const fresh = await tx
      .prepare(
        `INSERT INTO processed_events (event_id, type, processed_at) VALUES (?, ?, ?)
         ON CONFLICT (event_id) DO NOTHING`,
      )
      .bind(event.id, event.type, new Date().toISOString())
      .run();
    if (fresh.meta.changes === 0) return 'duplicate';

    await effect(tx, event);
    return 'processed';
  });
}

async function applyEffect(_tx: Database, event: QueueEvent): Promise<void> {
  const d = event.data;
  switch (event.type) {
    case 'hr.employee.offboarded':
      console.log(
        JSON.stringify({
          event: 'financial.recurring.review',
          employeeId: d.employeeId,
          lastDay: d.lastDay,
          note: 'Encerrar cobranças recorrentes vinculadas.',
        }),
      );
      // TODO(financial): cancelar agendamentos recorrentes do colaborador.
      break;

    case 'legal.contract.active':
      console.log(
        JSON.stringify({
          event: 'financial.billing.enable',
          contractId: d.contractId,
          reference: d.reference,
        }),
      );
      // TODO(financial): criar cronograma de faturamento a partir do contrato.
      break;

    case 'operations.sla.breached': {
      /**
       * O evento que fecha o laço do sistema inteiro: o jurídico escreveu o
       * compromisso de disponibilidade, operações mediu o mês contra ele, e o
       * financeiro deve a diferença ao cliente.
       *
       * O valor chega calculado, pela computeSlaCredit compartilhada em
       * @ssm/contracts. Recalcular aqui seria uma segunda implementação de um
       * número que aparece numa fatura — exatamente a divergência que esta
       * arquitetura evita.
       */
      const credit = d.credit as { amountMinor: number; currency: string } | undefined;
      console.warn(
        JSON.stringify({
          event: 'financial.sla.credit_due',
          environmentCode: d.environmentCode,
          month: d.month,
          achievedBps: d.achievedBps,
          targetBps: d.targetBps,
          creditMinor: credit?.amountMinor,
          currency: credit?.currency,
          contractRef: d.contractRef,
        }),
      );
      // TODO(financial): emitir nota de crédito e abatê-la da próxima fatura.
      // Depende das notas de crédito, ainda pendentes. Quando existir, a escrita
      // usa o `tx` recebido: o efeito e a marca de processado valem juntos.
      break;
    }

    default:
      // Evento que não interessa ainda assim é marcado como processado: ele não
      // deve voltar à fila a cada reentrega só por não ter tratamento.
      break;
  }
}

export async function drainOutbox(env: AppEnv['Bindings'], db: Database): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT id, type, payload, tenant_id, actor_id, correlation_id
         FROM outbox
        WHERE published_at IS NULL AND attempts < 5
        ORDER BY created_at
        LIMIT 50`,
    )
    .all<{
      id: string;
      type: string;
      /** jsonb: o driver já devolve o objeto. */
      payload: unknown;
      tenant_id: string;
      actor_id: string | null;
      correlation_id: string;
    }>();

  for (const row of results) {
    try {
      // O leque é decidido no publicador, a partir de SERVICE_BINDINGS: as
      // filas do Cloudflare são ponto a ponto e não têm exchange de tópico.
      await env.QUEUE_LEGAL.send({
        id: row.id,
        type: row.type,
        data: row.payload,
        tenantId: row.tenant_id,
        actorId: row.actor_id,
        correlationId: row.correlation_id,
        occurredAt: new Date().toISOString(),
        source: 'financial-worker',
        version: 1,
      });
      await db.prepare('UPDATE outbox SET published_at = now() WHERE id = ?').bind(row.id).run();
    } catch (err) {
      await db
        .prepare('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?')
        .bind(String(err).slice(0, 500), row.id)
        .run();
    }
  }
}

// O Durable Object é declarado no gateway; reexportado aqui para que o binding
// resolva em desenvolvimento local, onde não há script separado.
export { Coordinator };
