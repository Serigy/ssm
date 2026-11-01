import {
  createEmployeeSchema,
  employeeFilterSchema,
  offboardEmployeeSchema,
  pageQuerySchema,
  updateEmployeeSchema,
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
  openFromBinding,
  type Database,
} from '@ssm/worker-common';
import { z } from 'zod';
import {
  activateEmployee,
  createEmployee,
  offboardEmployee,
  terminateOverdue,
  updateEmployee,
} from './commands.js';
import { findEmployeeRow, listEmployees, toFullDto, toSafeDto } from './queries.js';

// RH já está no Neon (ADR 0014): `postgres` abre a conexão da requisição.
const app = createApp('/api/hr', { postgres: true });
const BASE = '/api/hr/v1/employees';

/**
 * Quem vê o quê.
 *
 * `hr:employee:read` mostra nome, cargo, situação. `hr:payroll:read` acrescenta
 * salário, CPF, telefone, endereço e datas pessoais. A separação existe porque
 * a maioria de quem precisa da lista de pessoas não precisa da folha, e a
 * permissão mais estreita é a que deve ser distribuída.
 */
const canSeePii = (c: { get: (k: 'actor') => { permissions: Set<string> } }) =>
  c.get('actor').permissions.has('hr:payroll:read');

app.get(BASE, requireAuth(), requirePermissions('hr:employee:read'), async (c) => {
  const { limit, cursor, sort, ...filter } = parse(
    employeeFilterSchema.merge(pageQuerySchema),
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  const { rows, nextCursor } = await listEmployees(c.get('db'), c.get('actor').tenantId, filter, {
    limit,
    cursor,
    sort,
  });

  // A listagem nunca decifra: são N decifras por página, e a tela de lista não
  // mostra CPF nenhum. Quem precisa do dado completo abre o registro.
  const items = canSeePii(c)
    ? await Promise.all(rows.map((r) => toFullDto(c.env, r)))
    : rows.map(toSafeDto);
  return c.json({ items, nextCursor });
});

app.get(`${BASE}/:id`, requireAuth(), requirePermissions('hr:employee:read'), async (c) => {
  const row = await findEmployeeRow(c.get('db'), c.get('actor').tenantId, c.req.param('id'));
  // Mesmo 404 para "não existe" e "é de outro cliente".
  if (!row) throw HttpProblem.notFound(`Colaborador ${c.req.param('id')} não encontrado.`);
  return c.json(canSeePii(c) ? await toFullDto(c.env, row) : toSafeDto(row));
});

app.post(BASE, requireAuth(), requirePermissions('hr:employee:create'), async (c) => {
  const dto = parse(createEmployeeSchema, await c.req.json().catch(() => null));
  const actor = c.get('actor');
  if (dto.nationalId && !actor.permissions.has('hr:payroll:read')) {
    // Aceitar o CPF de quem não pode lê-lo de volta cria um dado que quem
    // gravou não consegue conferir — e um caminho de escrita sem leitura é onde
    // erro de digitação em documento sobrevive por anos.
    throw HttpProblem.forbidden('Gravar CPF exige hr:payroll:read.');
  }
  const employee = await createEmployee(c.env, c.get('db'), actor.tenantId, actor.id, dto);
  c.header('Location', `${BASE}/${employee.id}`);
  return c.json(employee, 201);
});

app.patch(`${BASE}/:id`, requireAuth(), requirePermissions('hr:employee:update'), async (c) => {
  const dto = parse(updateEmployeeSchema, await c.req.json().catch(() => null));
  const actor = c.get('actor');
  if (dto.nationalId && !actor.permissions.has('hr:payroll:read')) {
    throw HttpProblem.forbidden('Gravar CPF exige hr:payroll:read.');
  }
  return c.json(await updateEmployee(c.env, c.get('db'), actor.tenantId, actor.id, c.req.param('id'), dto));
});

app.post(
  `${BASE}/:id/activate`,
  requireAuth(),
  requirePermissions('hr:employee:update'),
  idempotent(),
  async (c) => {
    const actor = c.get('actor');
    return c.json(
      await activateEmployee(c.env, c.get('db'), actor.tenantId, actor.id, c.req.param('id'), c.get('traceId')),
    );
  },
);

app.post(
  `${BASE}/:id/offboard`,
  requireAuth(),
  requirePermissions('hr:employee:delete'),
  idempotent(),
  async (c) => {
    const dto = parse(offboardEmployeeSchema, await c.req.json().catch(() => null));
    const actor = c.get('actor');
    return c.json(
      await offboardEmployee(
        c.env,
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
    // Não passa pelo Hono, então abre e fecha a própria conexão — uma para as
    // duas tarefas, fechada quando ambas terminam.
    const db = openFromBinding(env.HYPERDRIVE);
    ctx.waitUntil(
      Promise.all([
        drainOutbox(env, db),
        // Quem chegou ao último dia deixa de contar como quadro ativo. É barato
        // o suficiente para rodar junto com o relay em vez de merecer outro
        // gatilho.
        terminateOverdue(db).then((n) => {
          if (n) console.log(JSON.stringify({ event: 'hr.employee.terminated_overdue', count: n }));
        }),
      ]).finally(() => db.close()),
    );
  },
} satisfies ExportedHandler<AppEnv['Bindings']>);

export async function drainOutbox(env: AppEnv['Bindings'], db: Database): Promise<void> {
  const { results } = await db.prepare(
    `SELECT id, type, payload, tenant_id, actor_id, correlation_id
       FROM outbox WHERE published_at IS NULL AND attempts < 5
      ORDER BY created_at LIMIT 50`,
  ).all<{
    id: string;
    type: string;
    /** jsonb: o driver já devolve o objeto. */
    payload: unknown;
    tenant_id: string;
    actor_id: string | null;
    correlation_id: string;
  }>();

  for (const row of results) {
    const envelope = {
      id: row.id,
      type: row.type,
      data: row.payload,
      tenantId: row.tenant_id,
      actorId: row.actor_id,
      correlationId: row.correlation_id,
      occurredAt: new Date().toISOString(),
      source: 'hr-worker',
      version: 1,
    };
    try {
      // O leque é decidido aqui: as filas do Cloudflare são ponto a ponto e não
      // têm exchange de tópico. O desligamento interessa a dois módulos.
      await Promise.all([env.QUEUE_FINANCIAL.send(envelope), env.QUEUE_LEGAL.send(envelope)]);
      await db.prepare('UPDATE outbox SET published_at = now() WHERE id = ?').bind(row.id).run();
    } catch (err) {
      await db.prepare('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?')
        .bind(String(err).slice(0, 500), row.id)
        .run();
    }
  }
}

export { Coordinator };
