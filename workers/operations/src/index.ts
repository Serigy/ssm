import {
  assignTicketSchema,
  createEnvironmentSchema,
  createTicketSchema,
  environmentFilterSchema,
  pageQuerySchema,
  reckonSlaSchema,
  scheduleWindowSchema,
  ticketFilterSchema,
  transitionTicketSchema,
  updateEnvironmentSchema,
} from '@ssm/contracts';
import {
  createApp,
  requireAuth,
  requirePermissions,
  idempotent,
  HttpProblem,
  Coordinator,
  type AppEnv,
  withMonitoring,
} from '@ssm/worker-common';
import { z } from 'zod';
import {
  assignTicket,
  createEnvironment,
  createTicket,
  reckonSla,
  scheduleWindow,
  toSlaDto,
  transitionTicket,
  updateEnvironment,
  type SlaPeriodRow,
} from './commands.js';
import {
  findEnvironmentRow,
  findTicketRow,
  listEnvironments,
  listTickets,
  toEnvironmentDto,
  toTicketDto,
} from './queries.js';

const app = createApp('/api/operations');
const TICKETS = '/api/operations/v1/tickets';
const ENVIRONMENTS = '/api/operations/v1/environments';
const SLA = '/api/operations/v1/sla';

// --- chamados ---------------------------------------------------------------

app.get(TICKETS, requireAuth(), requirePermissions('operations:ticket:read'), async (c) => {
  const { limit, cursor, sort, ...filter } = parse(
    ticketFilterSchema.merge(pageQuerySchema),
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  const { rows, nextCursor } = await listTickets(c.env.DB, c.get('actor').tenantId, filter, {
    limit,
    cursor,
    sort,
  });
  return c.json({ items: rows.map(toTicketDto), nextCursor });
});

app.get(`${TICKETS}/:id`, requireAuth(), requirePermissions('operations:ticket:read'), async (c) => {
  const row = await findTicketRow(c.env.DB, c.get('actor').tenantId, c.req.param('id'));
  if (!row) throw HttpProblem.notFound(`Chamado ${c.req.param('id')} não encontrado.`);
  return c.json(toTicketDto(row));
});

app.post(TICKETS, requireAuth(), requirePermissions('operations:ticket:create'), async (c) => {
  const dto = parse(createTicketSchema, await c.req.json().catch(() => null));
  const actor = c.get('actor');
  const ticket = await createTicket(c.env, actor.tenantId, actor.id, dto, c.get('traceId'));
  c.header('Location', `${TICKETS}/${ticket.id}`);
  return c.json(ticket, 201);
});

app.post(
  `${TICKETS}/:id/status`,
  requireAuth(),
  requirePermissions('operations:ticket:update'),
  idempotent(),
  async (c) => {
    const dto = parse(transitionTicketSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    return c.json(
      await transitionTicket(
        c.env,
        actor.tenantId,
        actor.id,
        c.req.param('id'),
        dto.status,
        dto.note,
        c.get('traceId'),
      ),
    );
  },
);

app.post(
  `${TICKETS}/:id/assign`,
  requireAuth(),
  requirePermissions('operations:ticket:update'),
  async (c) => {
    const dto = parse(assignTicketSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    return c.json(
      await assignTicket(c.env, actor.tenantId, actor.id, c.req.param('id'), dto.assigneeId),
    );
  },
);

// --- ambientes --------------------------------------------------------------

app.get(
  ENVIRONMENTS,
  requireAuth(),
  requirePermissions('operations:environment:read'),
  async (c) => {
    const filter = parse(
      environmentFilterSchema,
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    const rows = await listEnvironments(c.env.DB, c.get('actor').tenantId, filter);
    return c.json({ items: rows.map(toEnvironmentDto), nextCursor: null });
  },
);

app.get(
  `${ENVIRONMENTS}/:id`,
  requireAuth(),
  requirePermissions('operations:environment:read'),
  async (c) => {
    const row = await findEnvironmentRow(c.env.DB, c.get('actor').tenantId, c.req.param('id'));
    if (!row) throw HttpProblem.notFound(`Ambiente ${c.req.param('id')} não encontrado.`);
    return c.json(toEnvironmentDto(row));
  },
);

app.post(
  ENVIRONMENTS,
  requireAuth(),
  requirePermissions('operations:environment:create'),
  async (c) => {
    const dto = parse(createEnvironmentSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    const environment = await createEnvironment(c.env, actor.tenantId, actor.id, dto);
    c.header('Location', `${ENVIRONMENTS}/${environment.id}`);
    return c.json(environment, 201);
  },
);

app.patch(
  `${ENVIRONMENTS}/:id`,
  requireAuth(),
  requirePermissions('operations:environment:update'),
  async (c) => {
    const dto = parse(updateEnvironmentSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    return c.json(await updateEnvironment(c.env, actor.tenantId, actor.id, c.req.param('id'), dto));
  },
);

app.post(
  `${ENVIRONMENTS}/:id/window`,
  requireAuth(),
  requirePermissions('operations:environment:update'),
  idempotent(),
  async (c) => {
    const dto = parse(scheduleWindowSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    return c.json(await scheduleWindow(c.env, actor.tenantId, actor.id, c.req.param('id'), dto));
  },
);

// --- SLA --------------------------------------------------------------------

app.get(SLA, requireAuth(), requirePermissions('operations:sla:read'), async (c) => {
  const params = new URL(c.req.url).searchParams;
  const where: string[] = ['tenant_id = ?'];
  const binds: unknown[] = [c.get('actor').tenantId];
  const environmentId = params.get('environmentId');
  const month = params.get('month');
  if (environmentId) {
    where.push('environment_id = ?');
    binds.push(environmentId);
  }
  if (month) {
    where.push('month = ?');
    binds.push(month);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM sla_periods WHERE ${where.join(' AND ')} ORDER BY month DESC, environment_code LIMIT 200`,
  )
    .bind(...binds)
    .all<SlaPeriodRow>();

  // Array puro, e não página. É o formato que o controller em NestJS devolvia e
  // o que a tela de SLA consome — envolver em {items, nextCursor} por simetria
  // com as outras listagens quebrou a tela sem quebrar nenhum teste de API, que
  // é como um contrato de front-end se perde numa migração.
  return c.json(results.map(toSlaDto));
});

app.post(
  `${SLA}/reckon`,
  requireAuth(),
  requirePermissions('operations:sla:approve'),
  idempotent(),
  async (c) => {
    const dto = parse(reckonSlaSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    return c.json(await reckonSla(c.env, actor.tenantId, actor.id, dto, c.get('traceId')));
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
    ctx.waitUntil(markBreachedResponses(env));
  },
} satisfies ExportedHandler<AppEnv['Bindings']>);

/**
 * Marca descumprimento de prazo de resposta sem esperar alguém responder.
 *
 * Sem isto, um chamado que ninguém tocou nunca é marcado — a marca só entrava
 * na primeira transição, e o chamado abandonado é justamente o que mais
 * interessa ao relatório mensal. O filtro `breached` da listagem já cobre o
 * caso em tempo de consulta; esta varredura grava, para a apuração do mês não
 * depender de quando alguém olhou.
 */
async function markBreachedResponses(env: AppEnv['Bindings']): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE tickets
        SET response_breached = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE response_breached = 0
        AND first_response_at IS NULL
        AND response_due_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND status NOT IN ('cancelled','closed')`,
  ).run();
  if (result.meta.changes) {
    console.warn(
      JSON.stringify({ event: 'operations.ticket.response_breached', count: result.meta.changes }),
    );
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
      // O crédito de SLA vira linha de fatura; é o financeiro que precisa saber.
      await env.QUEUE_FINANCIAL.send({
        id: row.id,
        type: row.type,
        data: JSON.parse(row.payload),
        tenantId: row.tenant_id,
        actorId: row.actor_id,
        correlationId: row.correlation_id,
        occurredAt: new Date().toISOString(),
        source: 'operations-worker',
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
