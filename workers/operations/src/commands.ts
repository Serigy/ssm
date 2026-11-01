import {
  computeAvailabilityBps,
  computeSlaCredit,
  money,
  type CreateEnvironment,
  type CreateTicket,
  type Environment,
  type MaintenanceWindow,
  type ReckonSla,
  type Severity,
  type SlaPeriod,
  type Ticket,
  type TicketEvent,
  type TicketStatus,
  type UpdateEnvironment,
} from '@ssm/contracts';
import {
  HttpProblem,
  withReservedNumber,
  type BaseBindings,
} from '@ssm/worker-common';
import {
  findEnvironmentRow,
  findTicketRow,
  toEnvironmentDto,
  toTicketDto,
  type EnvironmentRow,
  type TicketRow,
} from './queries.js';

/**
 * Ciclo de vida do chamado.
 *
 * `waiting_customer` é estado e não sinalizador porque é a única coisa que
 * legitimamente pausa o relógio de resolução — o contrato não pode cobrar prazo
 * da Serigy enquanto a resposta está com o cliente.
 */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['waiting_customer', 'resolved', 'cancelled'],
  waiting_customer: ['in_progress', 'cancelled'],
  resolved: ['closed', 'in_progress'],
  closed: [],
  cancelled: [],
};

export const TICKET_TRANSITIONS = TRANSITIONS;

/** Prazos para chamado sem ambiente vinculado. */
const DEFAULT_RESPONSE_MINUTES: Record<Severity, number> = { sev1: 15, sev2: 60, sev3: 480 };

const iso = (d: Date = new Date()) => d.toISOString();

// --- chamados ---------------------------------------------------------------

export async function createTicket(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  dto: CreateTicket,
  correlationId: string,
): Promise<Ticket> {
  let environment: EnvironmentRow | null = null;
  if (dto.environmentId) {
    environment = await findEnvironmentRow(env.DB, tenantId, dto.environmentId);
    if (!environment) throw HttpProblem.notFound(`Ambiente ${dto.environmentId} não encontrado.`);
  }

  const openedAt = new Date();
  const minutes = environment
    ? responseMinutesFor(environment, dto.severity)
    : DEFAULT_RESPONSE_MINUTES[dto.severity];

  const seed = await highestTicketNumber(env.DB, tenantId);
  const id = crypto.randomUUID();

  return withReservedNumber(env, tenantId, 'tickets', seed, async (number) => {
    const timeline: TicketEvent[] = [
      {
        at: iso(openedAt),
        actorId,
        kind: 'created',
        note: `Chamado aberto com severidade ${dto.severity}.`,
      },
    ];

    const statements = [
      env.DB.prepare(
        `INSERT INTO tickets (
           id, tenant_id, number, subject, description, kind, severity, status,
           environment_id, environment_code, assignee_id, opened_at,
           response_due_at, timeline, created_by, updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        tenantId,
        number,
        dto.subject,
        dto.description ?? '',
        dto.kind ?? 'incident',
        dto.severity,
        environment?.id ?? null,
        environment?.code ?? null,
        dto.assigneeId ?? null,
        iso(openedAt),
        iso(new Date(openedAt.getTime() + minutes * 60_000)),
        JSON.stringify(timeline),
        actorId,
        actorId,
      ),
    ];

    // Um sev1 num ambiente coloca o ambiente em incidente: a lista de ambientes
    // é o painel de quem está de plantão, e ela precisa refletir o que está
    // acontecendo sem que alguém tenha de atualizar dois lugares.
    if (environment && dto.severity === 'sev1' && environment.status === 'operational') {
      statements.push(
        env.DB.prepare(
          `UPDATE environments SET status = 'incident', updated_by = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ? AND status = 'operational'`,
        ).bind(actorId, iso(), environment.id, tenantId),
      );
      statements.push(
        outboxInsert(env, {
          aggregateType: 'ticket',
          aggregateId: id,
          type: 'operations.incident.opened',
          tenantId,
          actorId,
          correlationId,
          payload: {
            ticketId: id,
            number,
            environmentId: environment.id,
            environmentCode: environment.code,
            severity: dto.severity,
          },
        }),
      );
    }

    await env.DB.batch(statements);
    return toTicketDto((await findTicketRow(env.DB, tenantId, id))!);
  });
}

export async function transitionTicket(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  to: TicketStatus,
  note: string | undefined,
  correlationId: string,
): Promise<Ticket> {
  const t = await mustFindTicket(env, tenantId, id);
  const from = t.status as TicketStatus;

  if (!TRANSITIONS[from].includes(to)) {
    throw HttpProblem.conflict(
      `Transição inválida: "${from}" não pode ir para "${to}". ` +
        `Possíveis: ${TRANSITIONS[from].join(', ') || 'nenhuma'}.`,
    );
  }

  const now = new Date();
  const nowIso = iso(now);

  // A primeira saída de `open` É a primeira resposta. Registrar aqui, em vez de
  // pedir que alguém clique em "responder", faz o número do SLA refletir o que
  // aconteceu e não o que foi lembrado.
  const firstResponseAt = from === 'open' && !t.first_response_at ? nowIso : t.first_response_at;
  const responseBreached =
    from === 'open' && !t.first_response_at
      ? nowIso > t.response_due_at
        ? 1
        : 0
      : t.response_breached;

  // Acumula a pausa ao sair de waiting_customer, para o relógio de resolução
  // excluir o tempo em que a resposta estava com o cliente.
  let pausedMinutes = t.paused_minutes;
  if (from === 'waiting_customer' && t.waiting_since) {
    pausedMinutes += Math.round((now.getTime() - new Date(t.waiting_since).getTime()) / 60_000);
  }
  const waitingSince = to === 'waiting_customer' ? nowIso : null;

  const timeline: TicketEvent[] = [
    ...(JSON.parse(t.timeline) as TicketEvent[]),
    { at: nowIso, actorId, kind: 'status', note: note ?? `Estado alterado para ${to}.` },
  ];

  const statements = [
    env.DB.prepare(
      `UPDATE tickets
          SET status = ?, first_response_at = ?, response_breached = ?,
              paused_minutes = ?, waiting_since = ?,
              resolved_at = ?, closed_at = ?, timeline = ?,
              updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = ?`,
    ).bind(
      to,
      firstResponseAt,
      responseBreached,
      pausedMinutes,
      waitingSince,
      to === 'resolved' ? nowIso : t.resolved_at,
      to === 'closed' ? nowIso : t.closed_at,
      JSON.stringify(timeline),
      actorId,
      nowIso,
      id,
      tenantId,
      from,
    ),
  ];

  if (to === 'resolved') {
    const elapsed = Math.round((now.getTime() - new Date(t.opened_at).getTime()) / 60_000);
    statements.push(
      outboxInsert(env, {
        aggregateType: 'ticket',
        aggregateId: id,
        type: 'operations.incident.resolved',
        tenantId,
        actorId,
        correlationId,
        payload: {
          ticketId: id,
          number: t.number,
          environmentId: t.environment_id,
          minutesToResolve: Math.max(0, elapsed - pausedMinutes),
          responseBreached: responseBreached === 1,
        },
      }),
    );

    // O ambiente volta a operacional quando o último sev1 aberto nele é
    // resolvido — e só então: dois incidentes simultâneos não podem fazer o
    // primeiro a fechar apagar o alarme do segundo.
    if (t.environment_id && t.severity === 'sev1') {
      statements.push(
        env.DB.prepare(
          `UPDATE environments SET status = 'operational', updated_by = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ? AND status = 'incident'
              AND NOT EXISTS (
                SELECT 1 FROM tickets o
                 WHERE o.environment_id = environments.id
                   AND o.severity = 'sev1'
                   AND o.id <> ?
                   AND o.status NOT IN ('resolved','closed','cancelled')
              )`,
        ).bind(actorId, nowIso, t.environment_id, tenantId, id),
      );
    }
  }

  const [updated] = await env.DB.batch(statements);
  if (!updated || updated.meta.changes === 0) {
    throw HttpProblem.conflict('A situação do chamado mudou enquanto era alterada.');
  }

  return toTicketDto((await findTicketRow(env.DB, tenantId, id))!);
}

export async function assignTicket(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  assigneeId: string | null,
): Promise<Ticket> {
  const t = await mustFindTicket(env, tenantId, id);
  const nowIso = iso();
  const timeline: TicketEvent[] = [
    ...(JSON.parse(t.timeline) as TicketEvent[]),
    {
      at: nowIso,
      actorId,
      kind: 'assigned',
      note: assigneeId ? `Atribuído a ${assigneeId}.` : 'Atribuição removida.',
    },
  ];

  await env.DB.prepare(
    `UPDATE tickets SET assignee_id = ?, timeline = ?, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`,
  )
    .bind(assigneeId, JSON.stringify(timeline), actorId, nowIso, id, tenantId)
    .run();

  return toTicketDto((await findTicketRow(env.DB, tenantId, id))!);
}

// --- ambientes --------------------------------------------------------------

export async function createEnvironment(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  dto: CreateEnvironment,
): Promise<Environment> {
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO environments (
         id, tenant_id, code, name, kind, region, provider, contract_ref,
         availability_target_bps, response_sev1_minutes, response_sev2_minutes,
         response_sev3_minutes, tags, notes, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        tenantId,
        dto.code,
        dto.name,
        dto.kind,
        dto.region ?? null,
        dto.provider ?? null,
        dto.contractRef ?? null,
        dto.availabilityTargetBps,
        dto.responseTargetMinutes.sev1,
        dto.responseTargetMinutes.sev2,
        dto.responseTargetMinutes.sev3,
        JSON.stringify(dto.tags ?? []),
        dto.notes ?? null,
        actorId,
        actorId,
      )
      .run();
  } catch (err) {
    // O índice único é quem decide; capturar aqui só troca um 500 por uma
    // mensagem que diz o que fazer.
    if (String(err).includes('UNIQUE')) {
      throw HttpProblem.conflict(`Já existe um ambiente com o código ${dto.code}.`);
    }
    throw err;
  }
  return toEnvironmentDto((await findEnvironmentRow(env.DB, tenantId, id))!);
}

export async function updateEnvironment(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  dto: UpdateEnvironment,
): Promise<Environment> {
  const e = await mustFindEnvironment(env, tenantId, id);
  await env.DB.prepare(
    `UPDATE environments
        SET name = ?, kind = ?, region = ?, provider = ?, contract_ref = ?,
            availability_target_bps = ?, response_sev1_minutes = ?,
            response_sev2_minutes = ?, response_sev3_minutes = ?, tags = ?,
            notes = ?, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`,
  )
    .bind(
      dto.name ?? e.name,
      dto.kind ?? e.kind,
      dto.region ?? e.region,
      dto.provider ?? e.provider,
      dto.contractRef ?? e.contract_ref,
      dto.availabilityTargetBps ?? e.availability_target_bps,
      dto.responseTargetMinutes?.sev1 ?? e.response_sev1_minutes,
      dto.responseTargetMinutes?.sev2 ?? e.response_sev2_minutes,
      dto.responseTargetMinutes?.sev3 ?? e.response_sev3_minutes,
      dto.tags ? JSON.stringify(dto.tags) : e.tags,
      dto.notes ?? e.notes,
      actorId,
      iso(),
      id,
      tenantId,
    )
    .run();
  return toEnvironmentDto((await findEnvironmentRow(env.DB, tenantId, id))!);
}

export async function scheduleWindow(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  window: MaintenanceWindow,
): Promise<Environment> {
  await mustFindEnvironment(env, tenantId, id);
  if (window.endsAt <= window.startsAt) {
    throw HttpProblem.badRequest('A janela precisa terminar depois de começar.');
  }
  await env.DB.prepare(
    `UPDATE environments SET next_window = ?, status = 'scheduled_window',
            updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND status <> 'incident'`,
  )
    .bind(JSON.stringify(window), actorId, iso(), id, tenantId)
    .run();

  return toEnvironmentDto((await findEnvironmentRow(env.DB, tenantId, id))!);
}

// --- SLA --------------------------------------------------------------------

/**
 * Apura o mês de um ambiente.
 *
 * Idempotente por construção: a apuração é prova, e prova que muda quando se
 * olha de novo não é prova. Uma segunda chamada devolve o que já foi apurado.
 */
export async function reckonSla(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  input: ReckonSla,
  correlationId: string,
): Promise<SlaPeriod> {
  const existing = await env.DB.prepare(
    'SELECT * FROM sla_periods WHERE tenant_id = ? AND environment_id = ? AND month = ?',
  )
    .bind(tenantId, input.environmentId, input.month)
    .first<SlaPeriodRow>();
  if (existing) return toSlaDto(existing);

  const e = await mustFindEnvironment(env, tenantId, input.environmentId);
  const { measuredMinutes, downtimeMinutes } = await measure(env, tenantId, e, input.month);

  const achievedBps = computeAvailabilityBps(measuredMinutes, downtimeMinutes);
  const breached = achievedBps < e.availability_target_bps;
  const creditMinor = breached
    ? computeSlaCredit(achievedBps, e.availability_target_bps, input.monthlyFee.amountMinor)
    : 0;

  const id = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      `INSERT INTO sla_periods (
         id, tenant_id, environment_id, environment_code, month, measured_minutes,
         downtime_minutes, achieved_bps, target_bps, breached, credit_minor, credit_currency
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      tenantId,
      e.id,
      e.code,
      input.month,
      measuredMinutes,
      downtimeMinutes,
      achievedBps,
      e.availability_target_bps,
      breached ? 1 : 0,
      creditMinor > 0 ? creditMinor : null,
      creditMinor > 0 ? input.monthlyFee.currency.toUpperCase() : null,
    ),
  ];

  // Só descumprimento com crédito de verdade interessa ao financeiro. Um mês
  // que ficou abaixo da meta por menos de um degrau de penalidade não deve
  // nada, e publicá-lo criaria trabalho sem dinheiro.
  if (breached && creditMinor > 0) {
    statements.push(
      outboxInsert(env, {
        aggregateType: 'sla_period',
        aggregateId: id,
        type: 'operations.sla.breached',
        tenantId,
        actorId,
        correlationId,
        payload: {
          environmentId: e.id,
          environmentCode: e.code,
          month: input.month,
          targetBps: e.availability_target_bps,
          achievedBps,
          downtimeMinutes,
          credit: money(creditMinor, input.monthlyFee.currency),
          contractRef: e.contract_ref,
        },
      }),
    );
  }

  await env.DB.batch(statements);
  return toSlaDto(
    (await env.DB.prepare('SELECT * FROM sla_periods WHERE id = ?').bind(id).first<SlaPeriodRow>())!,
  );
}

/**
 * Mede indisponibilidade a partir dos sev1 do mês.
 *
 * Os intervalos são recortados ao mês e depois fundidos: dois incidentes
 * sobrepostos são uma indisponibilidade, não duas, e somá-los separadamente
 * geraria um crédito maior do que o contrato prevê — dinheiro pago a mais por
 * erro de contagem.
 */
async function measure(
  env: BaseBindings,
  tenantId: string,
  e: EnvironmentRow,
  month: string,
): Promise<{ measuredMinutes: number; downtimeMinutes: number }> {
  const start = new Date(`${month}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const monthMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);

  const { results } = await env.DB.prepare(
    `SELECT opened_at, resolved_at, paused_minutes
       FROM tickets
      WHERE tenant_id = ? AND environment_id = ? AND severity = 'sev1'
        AND opened_at < ?
        AND (resolved_at IS NULL OR resolved_at >= ?)
      ORDER BY opened_at`,
  )
    .bind(tenantId, e.id, iso(end), iso(start))
    .all<{ opened_at: string; resolved_at: string | null; paused_minutes: number }>();

  const spans = results
    .map((t) => ({
      from: Math.max(new Date(t.opened_at).getTime(), start.getTime()),
      to: Math.min(new Date(t.resolved_at ?? iso(end)).getTime(), end.getTime()),
      paused: t.paused_minutes,
    }))
    .filter((s) => s.to > s.from);

  let downtime = 0;
  let cursor = -1;
  for (const span of spans) {
    const from = Math.max(span.from, cursor);
    if (span.to <= from) continue;
    downtime += Math.round((span.to - from) / 60_000) - span.paused;
    cursor = span.to;
  }

  // Janela programada é trabalho planejado e nunca conta contra a meta, então
  // sai do denominador em vez de virar indisponibilidade.
  const windowMinutes = scheduledMinutesIn(e, start, end);

  return {
    measuredMinutes: Math.max(0, monthMinutes - windowMinutes),
    downtimeMinutes: Math.max(0, downtime),
  };
}

function scheduledMinutesIn(e: EnvironmentRow, start: Date, end: Date): number {
  if (!e.next_window) return 0;
  const w = JSON.parse(e.next_window) as MaintenanceWindow;
  const from = Math.max(new Date(w.startsAt).getTime(), start.getTime());
  const to = Math.min(new Date(w.endsAt).getTime(), end.getTime());
  return to > from ? Math.round((to - from) / 60_000) : 0;
}

export interface SlaPeriodRow {
  id: string;
  tenant_id: string;
  environment_id: string;
  environment_code: string;
  month: string;
  measured_minutes: number;
  downtime_minutes: number;
  achieved_bps: number;
  target_bps: number;
  breached: number;
  credit_minor: number | null;
  credit_currency: string | null;
  reckoned_at: string;
}

export function toSlaDto(r: SlaPeriodRow): SlaPeriod {
  return {
    month: r.month,
    environmentId: r.environment_id,
    environmentCode: r.environment_code,
    measuredMinutes: r.measured_minutes,
    downtimeMinutes: r.downtime_minutes,
    achievedBps: r.achieved_bps,
    targetBps: r.target_bps,
    breached: r.breached === 1,
    credit:
      r.credit_minor !== null && r.credit_currency
        ? money(r.credit_minor, r.credit_currency)
        : null,
    reckonedAt: r.reckoned_at,
  };
}

// --- apoio ------------------------------------------------------------------

function responseMinutesFor(e: EnvironmentRow, severity: Severity): number {
  return severity === 'sev1'
    ? e.response_sev1_minutes
    : severity === 'sev2'
      ? e.response_sev2_minutes
      : e.response_sev3_minutes;
}

/** O número do chamado é inteiro, não tem prefixo — MAX direto. */
async function highestTicketNumber(db: D1Database, tenantId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(number), 0) AS last FROM tickets WHERE tenant_id = ?')
    .bind(tenantId)
    .first<{ last: number }>();
  return row?.last ?? 0;
}

async function mustFindTicket(
  env: BaseBindings,
  tenantId: string,
  id: string,
): Promise<TicketRow> {
  const t = await findTicketRow(env.DB, tenantId, id);
  if (!t) throw HttpProblem.notFound(`Chamado ${id} não encontrado.`);
  return t;
}

async function mustFindEnvironment(
  env: BaseBindings,
  tenantId: string,
  id: string,
): Promise<EnvironmentRow> {
  const e = await findEnvironmentRow(env.DB, tenantId, id);
  if (!e) throw HttpProblem.notFound(`Ambiente ${id} não encontrado.`);
  return e;
}

interface OutboxEvent {
  aggregateType: string;
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    event.aggregateType,
    event.aggregateId,
    event.type,
    JSON.stringify(event.payload),
    event.tenantId,
    event.actorId,
    event.correlationId,
  );
}
