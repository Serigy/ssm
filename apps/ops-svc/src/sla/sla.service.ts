import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  computeAvailabilityBps,
  computeSlaCredit,
  type SlaPeriod,
} from '@ssm/contracts';
import { correlationId } from '@ssm/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { OutboxEntity } from '../database/outbox.entity.js';
import { EnvironmentEntity } from '../environments/environment.entity.js';
import { TicketEntity } from '../tickets/ticket.entity.js';
import { SlaPeriodEntity } from './sla-period.entity.js';

export interface ReckonInput {
  month: string;
  environmentId: string;
  /** Monthly fee from the contract, in minor units — the penalty base. */
  monthlyFeeMinor: number;
  currency: string;
}

/**
 * Monthly availability reckoning.
 *
 * This is the seam where all four modules meet: the target comes from the legal
 * contract, the downtime comes from operations' own tickets, and a breach
 * produces a credit that financial applies to an invoice.
 *
 * Two properties are load-bearing:
 *
 *   - **Downtime is derived from sev1 tickets, not typed in.** A figure someone
 *     enters by hand is a figure someone can be argued out of; a figure derived
 *     from the incident record has an audit trail behind it.
 *
 *   - **A reckoning is written once.** It becomes a credit on a customer's
 *     invoice, so silently recomputing it would change a number the customer
 *     already saw. Re-running returns the stored result.
 */
@Injectable()
export class SlaService {
  private readonly log = new Logger(SlaService.name);

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async list(tenantId: string, month?: string): Promise<SlaPeriod[]> {
    const qb = this.db
      .getRepository(SlaPeriodEntity)
      .createQueryBuilder('p')
      .where('p.tenantId = :tenantId', { tenantId });
    if (month) qb.andWhere('p.month = :month', { month });
    qb.orderBy('p.month', 'DESC').addOrderBy('p.environmentCode', 'ASC');
    return (await qb.getMany()).map(toDto);
  }

  async reckon(tenantId: string, actorId: string, input: ReckonInput): Promise<SlaPeriod> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.findOne(SlaPeriodEntity, {
        where: { tenantId, environmentId: input.environmentId, month: input.month },
      });
      // Idempotent by construction: the reckoning is evidence, and evidence
      // that changes when you look at it again is not evidence.
      if (existing) return toDto(existing);

      const env = await tx.findOne(EnvironmentEntity, {
        where: { id: input.environmentId, tenantId },
      });
      if (!env) throw new NotFoundException(`Ambiente ${input.environmentId} não encontrado.`);

      const { measuredMinutes, downtimeMinutes } = await this.measure(tx, tenantId, env, input.month);

      const achievedBps = computeAvailabilityBps(measuredMinutes, downtimeMinutes);
      const breached = achievedBps < env.availabilityTargetBps;
      const creditMinor = breached
        ? computeSlaCredit(achievedBps, env.availabilityTargetBps, input.monthlyFeeMinor)
        : 0;

      const period = tx.create(SlaPeriodEntity, {
        tenantId,
        environmentId: env.id,
        environmentCode: env.code,
        month: input.month,
        measuredMinutes,
        downtimeMinutes,
        achievedBps,
        targetBps: env.availabilityTargetBps,
        breached,
        creditMinor: creditMinor > 0 ? creditMinor : null,
        creditCurrency: creditMinor > 0 ? input.currency.toUpperCase() : null,
        reckonedAt: new Date(),
      });
      const saved = await tx.save(period);

      // Only a breach with an actual credit is worth telling financial about.
      // A month that missed the target by less than one penalty step owes
      // nothing, and publishing it would create work for no money.
      if (breached && creditMinor > 0) {
        await tx.insert(OutboxEntity, {
          id: randomUUID(),
          aggregateType: 'sla_period',
          aggregateId: saved.id,
          type: 'operations.sla.breached',
          payload: {
            environmentId: env.id,
            environmentCode: env.code,
            month: input.month,
            targetBps: env.availabilityTargetBps,
            achievedBps,
            downtimeMinutes,
            credit: { amountMinor: creditMinor, currency: input.currency.toUpperCase() },
            contractRef: env.contractRef,
          } as never,
          tenantId,
          actorId,
          correlationId: correlationId(),
          attempts: 0,
          publishedAt: null,
          lastError: null,
        });

        this.log.warn(
          `SLA descumprido em ${env.code} no mês ${input.month}: ` +
            `${(achievedBps / 100).toFixed(2)}% contra meta de ` +
            `${(env.availabilityTargetBps / 100).toFixed(2)}%. ` +
            `Crédito de ${creditMinor} (menor unidade) publicado ao financeiro.`,
        );
      }

      return toDto(saved);
    });
  }

  /**
   * Downtime for the month, from the incident record.
   *
   * Counted as the span of each sev1 ticket, from opening to resolution, minus
   * the time it spent waiting on the customer. Overlapping incidents are
   * merged, because two things broken at once is still one outage as far as the
   * customer experienced it — double-counting would inflate the credit and the
   * customer would be right to dispute it.
   */
  private async measure(
    tx: EntityManager,
    tenantId: string,
    env: EnvironmentEntity,
    month: string,
  ): Promise<{ measuredMinutes: number; downtimeMinutes: number }> {
    const start = new Date(`${month}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const monthMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);

    const incidents = await tx
      .getRepository(TicketEntity)
      .createQueryBuilder('t')
      .where('t.tenantId = :tenantId', { tenantId })
      .andWhere('t.environmentId = :envId', { envId: env.id })
      .andWhere("t.severity = 'sev1'")
      .andWhere('t.openedAt < :end', { end })
      .andWhere('(t.resolvedAt IS NULL OR t.resolvedAt >= :start)', { start })
      .orderBy('t.openedAt', 'ASC')
      .getMany();

    // Clamp each incident to the month, then merge overlaps.
    const spans = incidents
      .map((t) => ({
        from: Math.max(t.openedAt.getTime(), start.getTime()),
        to: Math.min((t.resolvedAt ?? end).getTime(), end.getTime()),
        paused: t.pausedMinutes,
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

    // A scheduled window is planned work and never counts against the target,
    // so it comes out of the denominator rather than being added to downtime.
    const windowMinutes = this.scheduledMinutesIn(env, start, end);

    return {
      measuredMinutes: Math.max(0, monthMinutes - windowMinutes),
      downtimeMinutes: Math.max(0, downtime),
    };
  }

  private scheduledMinutesIn(env: EnvironmentEntity, start: Date, end: Date): number {
    const w = env.nextWindow;
    if (!w) return 0;
    const from = Math.max(new Date(w.startsAt).getTime(), start.getTime());
    const to = Math.min(new Date(w.endsAt).getTime(), end.getTime());
    return to > from ? Math.round((to - from) / 60_000) : 0;
  }
}

function toDto(p: SlaPeriodEntity): SlaPeriod {
  return {
    month: typeof p.month === 'string' ? p.month : new Date(p.month).toISOString().slice(0, 10),
    environmentId: p.environmentId,
    environmentCode: p.environmentCode,
    measuredMinutes: p.measuredMinutes,
    downtimeMinutes: p.downtimeMinutes,
    achievedBps: p.achievedBps,
    targetBps: p.targetBps,
    breached: p.breached,
    credit:
      p.creditMinor !== null && p.creditCurrency
        ? { amountMinor: p.creditMinor, currency: p.creditCurrency }
        : null,
    reckonedAt: p.reckonedAt.toISOString(),
  };
}
