import {
  amendContractSchema,
  attachDocumentSchema,
  contractFilterSchema,
  contractTransitionSchema,
  createContractSchema,
  pageQuerySchema,
  updateContractSchema,
  uploadRequestSchema,
} from '@ssm/contracts';
import {
  createApp,
  requireAuth,
  requirePermissions,
  idempotent,
  HttpProblem,
  Coordinator,
  downloadTicket,
  uploadTicket,
  type AppEnv,
  captureUnexpected,
  withMonitoring,
} from '@ssm/worker-common';
import { z } from 'zod';
import {
  amendContract,
  attachDocument,
  createContract,
  noticeExpiring,
  transitionContract,
  updateContract,
} from './commands.js';
import { findContractRow, listContracts, toDto } from './queries.js';

const app = createApp('/api/legal');
const BASE = '/api/legal/v1/contracts';

app.get(BASE, requireAuth(), requirePermissions('legal:contract:read'), async (c) => {
  const { limit, cursor, sort, ...filter } = parse(
    contractFilterSchema.merge(pageQuerySchema),
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  const { rows, nextCursor } = await listContracts(c.env.DB, c.get('actor').tenantId, filter, {
    limit,
    cursor,
    sort,
  });
  return c.json({ items: rows.map(toDto), nextCursor });
});

/**
 * Atalho para o relatório de vencimentos.
 *
 * É a listagem com um filtro fixo, e existe como rota própria porque é o que a
 * tela inicial do jurídico abre — e porque um relatório com nome é mais fácil
 * de encontrar num log de auditoria do que uma consulta com parâmetro.
 *
 * Precisa vir antes de /:id, senão "expiring" é lido como um identificador.
 */
app.get(`${BASE}/expiring`, requireAuth(), requirePermissions('legal:contract:read'), async (c) => {
  const withinDays = Number(new URL(c.req.url).searchParams.get('withinDays') ?? '60');
  if (!Number.isInteger(withinDays) || withinDays < 1 || withinDays > 365) {
    throw HttpProblem.badRequest('withinDays deve ser um inteiro entre 1 e 365.');
  }
  const { rows } = await listContracts(
    c.env.DB,
    c.get('actor').tenantId,
    { expiringWithinDays: withinDays },
    { limit: 200, sort: undefined, cursor: undefined },
  );
  // Array puro: é o que a tela de vencimentos consome, e o que o controller em
  // NestJS devolvia. Ver a nota igual na listagem de SLA.
  return c.json(rows.map(toDto));
});

app.get(`${BASE}/:id`, requireAuth(), requirePermissions('legal:contract:read'), async (c) => {
  const row = await findContractRow(c.env.DB, c.get('actor').tenantId, c.req.param('id'));
  if (!row) throw HttpProblem.notFound(`Contrato ${c.req.param('id')} não encontrado.`);
  return c.json(toDto(row));
});

app.post(BASE, requireAuth(), requirePermissions('legal:contract:create'), async (c) => {
  const dto = parse(createContractSchema, await c.req.json().catch(() => null));
  const actor = c.get('actor');
  const contract = await createContract(c.env, actor.tenantId, actor.id, dto);
  c.header('Location', `${BASE}/${contract.id}`);
  return c.json(contract, 201);
});

app.patch(`${BASE}/:id`, requireAuth(), requirePermissions('legal:contract:update'), async (c) => {
  const dto = parse(updateContractSchema, await c.req.json().catch(() => null));
  const actor = c.get('actor');
  return c.json(await updateContract(c.env, actor.tenantId, actor.id, c.req.param('id'), dto));
});

app.post(
  `${BASE}/:id/amend`,
  requireAuth(),
  requirePermissions('legal:contract:update'),
  idempotent(),
  async (c) => {
    const dto = parse(amendContractSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    return c.json(
      await amendContract(c.env, actor.tenantId, actor.id, c.req.param('id'), dto.clauses, dto.note),
    );
  },
);

app.post(
  `${BASE}/:id/status`,
  requireAuth(),
  requirePermissions('legal:contract:approve'),
  idempotent(),
  async (c) => {
    const dto = parse(contractTransitionSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    return c.json(
      await transitionContract(
        c.env,
        actor.tenantId,
        actor.id,
        c.req.param('id'),
        dto.status,
        c.get('traceId'),
      ),
    );
  },
);

app.post(
  `${BASE}/:id/document/upload-url`,
  requireAuth(),
  requirePermissions('legal:contract:update'),
  async (c) => {
    const dto = parse(uploadRequestSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    const id = c.req.param('id');
    // Confere que o contrato existe e é deste cliente ANTES de assinar: um
    // bilhete assinado é permissão de escrita no balde, e não se emite permissão
    // para um caminho que ninguém verificou.
    if (!(await findContractRow(c.env.DB, actor.tenantId, id))) {
      throw HttpProblem.notFound(`Contrato ${id} não encontrado.`);
    }
    return c.json(
      await uploadTicket(c.env, 'contracts', actor.tenantId, id, dto.filename, dto.contentType),
    );
  },
);

app.post(
  `${BASE}/:id/document`,
  requireAuth(),
  requirePermissions('legal:contract:update'),
  async (c) => {
    const dto = parse(attachDocumentSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    return c.json(await attachDocument(c.env, actor.tenantId, actor.id, c.req.param('id'), dto.key));
  },
);

app.get(
  `${BASE}/:id/document`,
  requireAuth(),
  requirePermissions('legal:contract:read'),
  async (c) => {
    const row = await findContractRow(c.env.DB, c.get('actor').tenantId, c.req.param('id'));
    if (!row) throw HttpProblem.notFound(`Contrato ${c.req.param('id')} não encontrado.`);
    if (!row.document_key) {
      throw HttpProblem.notFound('Este contrato ainda não tem documento anexado.');
    }
    return c.json(await downloadTicket(c.env, row.document_key));
  },
);

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw HttpProblem.badRequest(
      result.error.issues.map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return result.data;
}

export default withMonitoring({
  fetch: app.fetch,

  async scheduled(_c: ScheduledController, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(drainOutbox(env));
    ctx.waitUntil(
      noticeExpiring(env).then((n) => {
        if (n) console.log(JSON.stringify({ event: 'legal.contract.expiring_noticed', count: n }));
      }),
    );
  },

  /**
   * O jurídico é consumidor além de produtor: um desligamento no RH sinaliza
   * contrato que nomeava aquela pessoa, e uma fatura emitida liga o contrato ao
   * faturamento.
   *
   * O consumo é idempotente porque a entrega da fila é ao-menos-uma-vez: o
   * mesmo evento pode chegar duas vezes, e a segunda não pode duplicar nada.
   */
  async queue(batch: MessageBatch<QueueEvent>, env: AppEnv['Bindings']) {
    for (const message of batch.messages) {
      try {
        await handleEvent(env, message.body);
        message.ack();
      } catch (err) {
        console.error(
          JSON.stringify({ event: 'legal.queue.failed', id: message.body?.id, err: String(err) }),
        );
        // Devolve para a fila; depois de max_retries vai para a DLQ em vez de
        // sumir.
        captureUnexpected(err, message.body?.correlationId ?? message.id);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<AppEnv['Bindings'], QueueEvent>);

interface QueueEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tenantId: string;
  correlationId: string;
}

async function handleEvent(env: AppEnv['Bindings'], event: QueueEvent): Promise<void> {
  // A tabela de eventos já processados é o que torna o consumo idempotente. A
  // chave é o id do evento, que o produtor gera uma vez e mantém entre
  // reentregas.
  const fresh = await env.DB.prepare(
    'INSERT OR IGNORE INTO processed_events (event_id, type, processed_at) VALUES (?, ?, ?)',
  )
    .bind(event.id, event.type, new Date().toISOString())
    .run();
  if (fresh.meta.changes === 0) return;

  if (event.type === 'hr.employee.offboarded') {
    // Marca para revisão os contratos que nomeiam a pessoa desligada. Não muda
    // situação de contrato sozinho: quem decide isso é o jurídico.
    //
    // A ligação é `externalRef`, que é o campo com que uma parte aponta para um
    // colaborador do RH ou uma contraparte do financeiro. A primeira versão
    // procurava `employeeId`, campo que a parte não tem — a consulta não dava
    // erro, simplesmente não casava com nada, e o efeito seria um recurso que
    // nunca dispara.
    await env.DB.prepare(
      `UPDATE contracts SET risk = 'high', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE tenant_id = ?
          AND status = 'active'
          AND EXISTS (
            SELECT 1 FROM json_each(contracts.parties)
             WHERE json_extract(json_each.value, '$.externalRef') = ?
          )`,
    )
      .bind(event.tenantId, String(event.data.employeeId))
      .run();
  }
}

async function drainOutbox(env: AppEnv['Bindings']): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT id, type, payload, tenant_id, actor_id, correlation_id
       FROM outbox WHERE published_at IS NULL AND attempts < 5
      ORDER BY created_at LIMIT 50`,
  ).all<{
    id: string;
    type: string;
    payload: string;
    tenant_id: string;
    actor_id: string | null;
    correlation_id: string;
  }>();

  for (const row of results) {
    try {
      await env.QUEUE_FINANCIAL.send({
        id: row.id,
        type: row.type,
        data: JSON.parse(row.payload),
        tenantId: row.tenant_id,
        actorId: row.actor_id,
        correlationId: row.correlation_id,
        occurredAt: new Date().toISOString(),
        source: 'legal-worker',
        version: 1,
      });
      await env.DB.prepare(
        `UPDATE outbox SET published_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
        .bind(row.id)
        .run();
    } catch (err) {
      await env.DB.prepare('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?')
        .bind(String(err).slice(0, 500), row.id)
        .run();
    }
  }
}

export { Coordinator };
