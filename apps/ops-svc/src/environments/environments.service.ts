import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  type CreateEnvironment,
  type Environment,
  type EnvironmentFilter,
  type MaintenanceWindow,
  type Page,
  type PageQuery,
  type UpdateEnvironment,
} from '@ssm/contracts';
import { correlationId } from '@ssm/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OutboxEntity } from '../database/outbox.entity.js';
import { EnvironmentEntity } from './environment.entity.js';

@Injectable()
export class EnvironmentsService {
  private readonly log = new Logger(EnvironmentsService.name);

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async list(
    tenantId: string,
    filter: EnvironmentFilter,
    page: PageQuery,
  ): Promise<Page<Environment>> {
    const qb = this.db
      .getRepository(EnvironmentEntity)
      .createQueryBuilder('e')
      .where('e.tenantId = :tenantId', { tenantId });

    if (filter.status) qb.andWhere('e.status = :status', { status: filter.status });
    if (filter.kind) qb.andWhere('e.kind = :kind', { kind: filter.kind });
    if (filter.tag) qb.andWhere(':tag = ANY(e.tags)', { tag: filter.tag });
    if (filter.q) {
      // Matches environments_search_trgm_idx exactly.
      qb.andWhere(`(coalesce(e.code, '') || ' ' || coalesce(e.name, '')) ILIKE :q`, {
        q: `%${filter.q}%`,
      });
    }

    if (page.cursor) {
      const { createdAt, id } = decodeCursor(page.cursor);
      qb.andWhere('("e"."created_at", "e"."id") < (:createdAt, :id)', { createdAt, id });
    }

    // Incidents first — the inventory screen exists to surface what is broken.
    qb.orderBy(
      `CASE e.status WHEN 'incident' THEN 0 WHEN 'scheduled_window' THEN 1 ELSE 2 END`,
      'ASC',
    )
      .addOrderBy('e.code', 'ASC')
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

  async findOne(tenantId: string, id: string): Promise<Environment> {
    const e = await this.db.getRepository(EnvironmentEntity).findOne({ where: { id, tenantId } });
    if (!e) throw new NotFoundException(`Ambiente ${id} não encontrado.`);
    return toDto(e);
  }

  async create(tenantId: string, actorId: string, dto: CreateEnvironment): Promise<Environment> {
    return this.db.transaction(async (tx) => {
      const duplicate = await tx.findOne(EnvironmentEntity, {
        where: { tenantId, code: dto.code },
      });
      if (duplicate) {
        throw new ConflictException(
          `Já existe um ambiente com o código ${dto.code}. Os códigos identificam o ambiente ` +
            'em chamados e na apuração de SLA, então precisam ser únicos.',
        );
      }

      const env = tx.create(EnvironmentEntity, {
        tenantId,
        code: dto.code,
        name: dto.name,
        kind: dto.kind,
        status: 'operational',
        region: dto.region ?? null,
        provider: dto.provider ?? null,
        contractRef: dto.contractRef ?? null,
        availabilityTargetBps: dto.availabilityTargetBps,
        responseSev1Minutes: dto.responseTargetMinutes.sev1,
        responseSev2Minutes: dto.responseTargetMinutes.sev2,
        responseSev3Minutes: dto.responseTargetMinutes.sev3,
        tags: dto.tags ?? [],
        nextWindow: null,
        notes: dto.notes ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      });

      const saved = await tx.save(env);

      await tx.insert(OutboxEntity, {
        id: randomUUID(),
        aggregateType: 'environment',
        aggregateId: saved.id,
        type: 'operations.environment.provisioned',
        payload: {
          environmentId: saved.id,
          code: saved.code,
          kind: saved.kind,
          contractRef: saved.contractRef,
        } as never,
        tenantId,
        actorId,
        correlationId: correlationId(),
        attempts: 0,
        publishedAt: null,
        lastError: null,
      });

      this.log.log(`Ambiente ${saved.code} provisionado.`);
      return toDto(saved);
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateEnvironment,
  ): Promise<Environment> {
    const env = await this.db.getRepository(EnvironmentEntity).findOne({ where: { id, tenantId } });
    if (!env) throw new NotFoundException(`Ambiente ${id} não encontrado.`);

    Object.assign(env, {
      name: dto.name ?? env.name,
      kind: dto.kind ?? env.kind,
      region: dto.region ?? env.region,
      provider: dto.provider ?? env.provider,
      contractRef: dto.contractRef ?? env.contractRef,
      availabilityTargetBps: dto.availabilityTargetBps ?? env.availabilityTargetBps,
      responseSev1Minutes: dto.responseTargetMinutes?.sev1 ?? env.responseSev1Minutes,
      responseSev2Minutes: dto.responseTargetMinutes?.sev2 ?? env.responseSev2Minutes,
      responseSev3Minutes: dto.responseTargetMinutes?.sev3 ?? env.responseSev3Minutes,
      tags: dto.tags ?? env.tags,
      notes: dto.notes ?? env.notes,
      updatedBy: actorId,
    });

    await this.db.getRepository(EnvironmentEntity).save(env);
    return toDto(env);
  }

  /**
   * Schedules maintenance.
   *
   * The state change matters beyond the calendar: downtime inside a scheduled
   * window is excluded from the availability reckoning, so declaring it in
   * advance is what separates planned work from an SLA breach.
   */
  async scheduleWindow(
    tenantId: string,
    actorId: string,
    id: string,
    window: MaintenanceWindow,
  ): Promise<Environment> {
    const env = await this.db.getRepository(EnvironmentEntity).findOne({ where: { id, tenantId } });
    if (!env) throw new NotFoundException(`Ambiente ${id} não encontrado.`);

    if (new Date(window.endsAt) <= new Date(window.startsAt)) {
      throw new ConflictException('A janela precisa terminar depois de começar.');
    }
    if (env.status === 'incident') {
      throw new ConflictException(
        'Este ambiente está em incidente. Resolva o chamado antes de agendar manutenção — ' +
          'senão a indisponibilidade atual sairia da apuração de SLA.',
      );
    }

    env.nextWindow = window;
    env.updatedBy = actorId;
    await this.db.getRepository(EnvironmentEntity).save(env);
    return toDto(env);
  }
}

function toDto(e: EnvironmentEntity): Environment {
  return {
    id: e.id,
    tenantId: e.tenantId,
    code: e.code,
    name: e.name,
    kind: e.kind,
    status: e.status,
    region: e.region,
    provider: e.provider,
    contractRef: e.contractRef,
    availabilityTargetBps: e.availabilityTargetBps,
    responseTargetMinutes: {
      sev1: e.responseSev1Minutes,
      sev2: e.responseSev2Minutes,
      sev3: e.responseSev3Minutes,
    },
    tags: e.tags ?? [],
    nextWindow: e.nextWindow,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
    createdBy: e.createdBy,
    updatedAt: e.updatedAt.toISOString(),
    updatedBy: e.updatedBy,
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
