import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  type CreateTicket,
  type Page,
  type PageQuery,
  type Severity,
  type Ticket,
  type TicketFilter,
  type TicketStatus,
} from '@ssm/contracts';
import { correlationId } from '@ssm/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { OutboxEntity } from '../database/outbox.entity.js';
import { EnvironmentEntity } from '../environments/environment.entity.js';
import { TicketEntity } from './ticket.entity.js';

/**
 * Legal transitions.
 *
 * `waiting_customer` is reachable from and returns to `in_progress` only,
 * because it exists to pause the clock — pausing from `open` would let a
 * ticket park before anyone has looked at it, which is exactly the abuse the
 * SLA is meant to prevent.
 */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['waiting_customer', 'resolved', 'cancelled'],
  waiting_customer: ['in_progress', 'cancelled'],
  resolved: ['closed', 'in_progress'],
  closed: [],
  cancelled: [],
};

/** Fallbacks for a ticket with no environment attached. */
const DEFAULT_RESPONSE_MINUTES: Record<Severity, number> = { sev1: 15, sev2: 60, sev3: 480 };

@Injectable()
export class TicketsService {
  private readonly log = new Logger(TicketsService.name);

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async list(tenantId: string, filter: TicketFilter, page: PageQuery): Promise<Page<Ticket>> {
    const qb = this.db
      .getRepository(TicketEntity)
      .createQueryBuilder('t')
      .where('t.tenantId = :tenantId', { tenantId });

    if (filter.status) qb.andWhere('t.status = :status', { status: filter.status });
    if (filter.severity) qb.andWhere('t.severity = :sev', { sev: filter.severity });
    if (filter.environmentId) qb.andWhere('t.environmentId = :env', { env: filter.environmentId });
    if (filter.assigneeId) qb.andWhere('t.assigneeId = :asg', { asg: filter.assigneeId });
    if (filter.breached !== undefined) {
      qb.andWhere('t.responseBreached = :b', { b: filter.breached });
    }
    if (filter.q) {
      // Same expression as tickets_search_trgm_idx — see the note in
      // financial-svc's InvoicesService.list. Index and query are one decision.
      qb.andWhere(
        `(coalesce(t.subject, '') || ' ' || coalesce(t.environment_code, '')) ILIKE :q`,
        { q: `%${filter.q}%` },
      );
    }

    if (page.cursor) {
      const { createdAt, id } = decodeCursor(page.cursor);
      qb.andWhere('("t"."created_at", "t"."id") < (:createdAt, :id)', { createdAt, id });
    }

    // Severity first: an open sev1 belongs at the top of the queue regardless
    // of when it arrived, which is how the on-call engineer reads this list.
    qb.orderBy('t.severity', 'ASC')
      .addOrderBy('t.createdAt', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .take(page.limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > page.limit;
    const items = hasMore ? rows.slice(0, page.limit) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map(toDto),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async findOne(tenantId: string, id: string): Promise<Ticket> {
    const t = await this.db.getRepository(TicketEntity).findOne({ where: { id, tenantId } });
    if (!t) throw new NotFoundException(`Chamado ${id} não encontrado.`);
    return toDto(t);
  }

  async create(tenantId: string, actorId: string, dto: CreateTicket): Promise<Ticket> {
    return this.db.transaction(async (tx) => {
      let environment: EnvironmentEntity | null = null;
      if (dto.environmentId) {
        environment = await tx.findOne(EnvironmentEntity, {
          where: { id: dto.environmentId, tenantId },
        });
        if (!environment) {
          throw new NotFoundException(`Ambiente ${dto.environmentId} não encontrado.`);
        }
      }

      const openedAt = new Date();
      const minutes = environment
        ? responseMinutesFor(environment, dto.severity)
        : DEFAULT_RESPONSE_MINUTES[dto.severity];

      const ticket = tx.create(TicketEntity, {
        tenantId,
        number: await this.nextNumber(tx, tenantId),
        subject: dto.subject,
        description: dto.description ?? '',
        kind: dto.kind ?? 'incident',
        severity: dto.severity,
        status: 'open',
        environmentId: environment?.id ?? null,
        environmentCode: environment?.code ?? null,
        assigneeId: dto.assigneeId ?? null,
        openedAt,
        firstResponseAt: null,
        resolvedAt: null,
        closedAt: null,
        responseDueAt: new Date(openedAt.getTime() + minutes * 60_000),
        responseBreached: false,
        pausedMinutes: 0,
        waitingSince: null,
        timeline: [
          {
            at: openedAt.toISOString(),
            actorId,
            kind: 'created',
            note: `Chamado aberto com severidade ${dto.severity}.`,
          },
        ],
        createdBy: actorId,
        updatedBy: actorId,
      });

      const saved = await tx.save(ticket);

      // A sev1 puts the environment into incident: the inventory screen is
      // where an operator looks first, and it must reflect reality without
      // anyone remembering to update it.
      if (environment && dto.severity === 'sev1' && environment.status === 'operational') {
        environment.status = 'incident';
        environment.updatedBy = actorId;
        await tx.save(environment);
      }

      await this.enqueue(tx, saved, 'operations.incident.opened', {
        ticketId: saved.id,
        number: saved.number,
        severity: saved.severity,
        environmentId: saved.environmentId,
        environmentCode: saved.environmentCode,
        responseDueAt: saved.responseDueAt.toISOString(),
      }, actorId);

      this.log.log(`Chamado #${saved.number} aberto (${saved.severity}).`);
      return toDto(saved);
    });
  }

  async transition(
    tenantId: string,
    actorId: string,
    id: string,
    to: TicketStatus,
    note?: string,
  ): Promise<Ticket> {
    return this.db.transaction(async (tx) => {
      const ticket = await tx.findOne(TicketEntity, {
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ticket) throw new NotFoundException(`Chamado ${id} não encontrado.`);

      if (!TRANSITIONS[ticket.status].includes(to)) {
        throw new ConflictException(
          `Transição inválida: "${ticket.status}" não pode ir para "${to}". ` +
            `Possíveis: ${TRANSITIONS[ticket.status].join(', ') || 'nenhuma'}.`,
        );
      }

      const now = new Date();

      // The first move out of `open` IS the first response. Recording it here
      // rather than asking someone to click "responder" means the SLA figure
      // reflects what happened, not what was remembered.
      if (ticket.status === 'open' && !ticket.firstResponseAt) {
        ticket.firstResponseAt = now;
        ticket.responseBreached = now > ticket.responseDueAt;
        if (ticket.responseBreached) {
          this.log.warn(
            `Chamado #${ticket.number} respondeu fora do prazo ` +
              `(vencia ${ticket.responseDueAt.toISOString()}).`,
          );
        }
      }

      // Accumulate the pause when leaving waiting_customer, so the resolution
      // clock excludes time the customer owed us an answer.
      if (ticket.status === 'waiting_customer' && ticket.waitingSince) {
        ticket.pausedMinutes += Math.round((now.getTime() - ticket.waitingSince.getTime()) / 60_000);
        ticket.waitingSince = null;
      }
      if (to === 'waiting_customer') ticket.waitingSince = now;
      if (to === 'resolved') ticket.resolvedAt = now;
      if (to === 'closed') ticket.closedAt = now;

      ticket.status = to;
      ticket.updatedBy = actorId;
      ticket.timeline = [
        ...ticket.timeline,
        {
          at: now.toISOString(),
          actorId,
          kind: 'status',
          note: note ?? `Estado alterado para ${to}.`,
        },
      ];
      await tx.save(ticket);

      if (to === 'resolved') {
        const elapsed = Math.round((now.getTime() - ticket.openedAt.getTime()) / 60_000);
        await this.enqueue(tx, ticket, 'operations.incident.resolved', {
          ticketId: ticket.id,
          number: ticket.number,
          environmentId: ticket.environmentId,
          minutesToResolve: Math.max(0, elapsed - ticket.pausedMinutes),
          responseBreached: ticket.responseBreached,
        }, actorId);

        await this.clearEnvironmentIncident(tx, tenantId, ticket, actorId);
      }

      return toDto(ticket);
    });
  }

  /**
   * Returns the environment to operational once no unresolved sev1 remains.
   *
   * Checked rather than assumed: two incidents can be open on one environment,
   * and resolving the first must not declare the environment healthy while the
   * second is still burning.
   */
  private async clearEnvironmentIncident(
    tx: EntityManager,
    tenantId: string,
    ticket: TicketEntity,
    actorId: string,
  ): Promise<void> {
    if (!ticket.environmentId || ticket.severity !== 'sev1') return;

    const stillBurning = await tx.count(TicketEntity, {
      where: [
        { tenantId, environmentId: ticket.environmentId, severity: 'sev1', status: 'open' },
        { tenantId, environmentId: ticket.environmentId, severity: 'sev1', status: 'in_progress' },
      ],
    });
    if (stillBurning > 0) return;

    const env = await tx.findOne(EnvironmentEntity, {
      where: { id: ticket.environmentId, tenantId },
    });
    if (env && env.status === 'incident') {
      env.status = 'operational';
      env.updatedBy = actorId;
      await tx.save(env);
    }
  }

  async assign(tenantId: string, actorId: string, id: string, assigneeId: string | null) {
    const ticket = await this.db.getRepository(TicketEntity).findOne({ where: { id, tenantId } });
    if (!ticket) throw new NotFoundException(`Chamado ${id} não encontrado.`);

    ticket.assigneeId = assigneeId;
    ticket.updatedBy = actorId;
    ticket.timeline = [
      ...ticket.timeline,
      {
        at: new Date().toISOString(),
        actorId,
        kind: 'assigned',
        note: assigneeId ? `Atribuído a ${assigneeId}.` : 'Atribuição removida.',
      },
    ];
    await this.db.getRepository(TicketEntity).save(ticket);
    return toDto(ticket);
  }

  /** Marks tickets whose response deadline passed unanswered. Runs on a timer. */
  async markBreaches(): Promise<number> {
    const result = await this.db
      .getRepository(TicketEntity)
      .createQueryBuilder()
      .update(TicketEntity)
      .set({ responseBreached: true })
      .where('response_breached = false')
      .andWhere('first_response_at IS NULL')
      .andWhere('response_due_at < now()')
      .andWhere("status IN ('open', 'in_progress')")
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Next ticket number for the tenant.
   *
   * Serialised with a transaction-scoped advisory lock rather than a row lock.
   * Two reasons:
   *
   *   - `SELECT MAX(...) ... FOR UPDATE` is rejected outright by Postgres —
   *     FOR UPDATE cannot be combined with an aggregate.
   *   - Locking the highest existing row, the obvious alternative, protects
   *     nothing when the table is empty: the very first two concurrent tickets
   *     of a tenant would both compute the same number and one would die on the
   *     unique index. An advisory lock exists whether or not there are rows.
   *
   * The lock is keyed on the tenant, so tenants never wait on each other, and
   * it is released at commit without anyone remembering to.
   */
  private async nextNumber(tx: EntityManager, tenantId: string): Promise<number> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`tickets:${tenantId}`]);
    const [row] = (await tx.query(
      `SELECT COALESCE(MAX(number), 4800) AS last FROM tickets WHERE tenant_id = $1`,
      [tenantId],
    )) as Array<{ last: number }>;
    return Number(row?.last ?? 4800) + 1;
  }

  private async enqueue(
    tx: EntityManager,
    ticket: TicketEntity,
    type: string,
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    await tx.insert(OutboxEntity, {
      id: randomUUID(),
      aggregateType: 'ticket',
      aggregateId: ticket.id,
      type,
      payload: payload as never,
      tenantId: ticket.tenantId,
      actorId,
      correlationId: correlationId(),
      attempts: 0,
      publishedAt: null,
      lastError: null,
    });
  }
}

function responseMinutesFor(env: EnvironmentEntity, severity: Severity): number {
  return severity === 'sev1'
    ? env.responseSev1Minutes
    : severity === 'sev2'
      ? env.responseSev2Minutes
      : env.responseSev3Minutes;
}

function toDto(t: TicketEntity): Ticket {
  return {
    id: t.id,
    tenantId: t.tenantId,
    number: t.number,
    subject: t.subject,
    description: t.description,
    kind: t.kind as never,
    severity: t.severity,
    status: t.status,
    environmentId: t.environmentId,
    environmentCode: t.environmentCode,
    assigneeId: t.assigneeId,
    openedAt: t.openedAt.toISOString(),
    firstResponseAt: t.firstResponseAt?.toISOString() ?? null,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    closedAt: t.closedAt?.toISOString() ?? null,
    responseDueAt: t.responseDueAt.toISOString(),
    responseBreached: t.responseBreached,
    pausedMinutes: t.pausedMinutes,
    timeline: t.timeline ?? [],
    createdAt: t.createdAt.toISOString(),
    createdBy: t.createdBy,
    updatedAt: t.updatedAt.toISOString(),
    updatedBy: t.updatedBy,
  };
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!createdAt || !id) throw new NotFoundException('Cursor de paginação inválido.');
  return { createdAt, id };
}
