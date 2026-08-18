import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  type CreateEmployee,
  type Employee,
  type EmployeeFilter,
  type EmployeeSafe,
  type EmploymentStatus,
  type OffboardEmployee,
  type Page,
  type PageQuery,
  type UpdateEmployee,
} from '@ssm/contracts';
import { SecretsService, correlationId } from '@ssm/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { OutboxEntity } from '../database/outbox.entity.js';
import { EmployeeEntity } from './employee.entity.js';

const TRANSITIONS: Record<EmploymentStatus, EmploymentStatus[]> = {
  applicant: ['onboarding', 'terminated'],
  onboarding: ['active', 'terminated'],
  active: ['on_leave', 'offboarding'],
  on_leave: ['active', 'offboarding'],
  offboarding: ['terminated'],
  terminated: [],
};

@Injectable()
export class EmployeesService {
  private readonly log = new Logger(EmployeesService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly secrets: SecretsService,
  ) {}

  /**
   * Key used by pgcrypto for the national id column. Read from the secrets
   * volume, never from an env var — see secrets/README.md.
   */
  private pii(): string {
    return this.secrets.require('pii_encryption_key');
  }

  async list(
    tenantId: string,
    filter: EmployeeFilter,
    page: PageQuery,
    canSeePii: boolean,
  ): Promise<Page<Employee | EmployeeSafe>> {
    const qb = this.db
      .getRepository(EmployeeEntity)
      .createQueryBuilder('e')
      // Entity property names, not column names — see the note in
      // financial-svc's InvoicesService.list for why that distinction bites.
      .where('e.tenantId = :tenantId', { tenantId });

    if (filter.status) qb.andWhere('e.status = :status', { status: filter.status });
    if (filter.departmentId) qb.andWhere('e.departmentId = :dep', { dep: filter.departmentId });
    if (filter.managerId) qb.andWhere('e.managerId = :mgr', { mgr: filter.managerId });
    if (filter.q) {
      // Must match employees_search_trgm_idx exactly — see the note in
      // financial-svc's InvoicesService.list.
      qb.andWhere(
        `(
          coalesce(e.first_name, '') || ' ' ||
          coalesce(e.last_name, '') || ' ' ||
          coalesce(e.work_email, '') || ' ' ||
          coalesce(e.employee_number, '')
        ) ILIKE :q`,
        { q: `%${filter.q}%` },
      );
    }

    if (page.cursor) {
      const { createdAt, id } = decodeCursor(page.cursor);
      qb.andWhere('("e"."created_at", "e"."id") < (:createdAt, :id)', { createdAt, id });
    }
    qb.orderBy('e.createdAt', 'DESC').addOrderBy('e.id', 'DESC').take(page.limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > page.limit;
    const items = hasMore ? rows.slice(0, page.limit) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map((e) => (canSeePii ? toFullDto(e) : toSafeDto(e))),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async findOne(
    tenantId: string,
    id: string,
    canSeePii: boolean,
  ): Promise<Employee | EmployeeSafe> {
    if (!canSeePii) {
      const e = await this.db.getRepository(EmployeeEntity).findOne({ where: { id, tenantId } });
      if (!e) throw new NotFoundException(`Colaborador ${id} não encontrado.`);
      return toSafeDto(e);
    }

    // Decryption happens in the database so the key never travels to Node and
    // the plaintext never sits in a query log.
    const [row] = (await this.db.query(
      `SELECT e.*, pgp_sym_decrypt(e.national_id_enc, $3) AS national_id
         FROM employees e WHERE e.id = $1 AND e.tenant_id = $2`,
      [id, tenantId, this.pii()],
    )) as Array<Record<string, unknown>>;

    if (!row) throw new NotFoundException(`Colaborador ${id} não encontrado.`);
    return rawToFullDto(row);
  }

  async create(tenantId: string, actorId: string, dto: CreateEmployee): Promise<Employee> {
    return this.db.transaction(async (tx) => {
      const duplicate = await tx.findOne(EmployeeEntity, {
        where: { tenantId, workEmail: dto.workEmail },
      });
      if (duplicate) {
        throw new ConflictException(
          `Já existe um colaborador com o e-mail ${dto.workEmail} (${duplicate.employeeNumber}).`,
        );
      }

      const employee = tx.create(EmployeeEntity, {
        tenantId,
        employeeNumber: await this.nextNumber(tx, tenantId),
        userId: null,
        firstName: dto.firstName,
        lastName: dto.lastName,
        workEmail: dto.workEmail,
        personalEmail: dto.personalEmail ?? null,
        phone: dto.phone ?? null,
        dateOfBirth: dto.dateOfBirth ?? null,
        status: 'onboarding',
        contractType: dto.contractType,
        jobTitle: dto.jobTitle,
        departmentId: dto.departmentId ?? null,
        managerId: dto.managerId ?? null,
        startDate: dto.startDate,
        endDate: null,
        salaryMinor: dto.salary?.amountMinor ?? null,
        salaryCurrency: dto.salary?.currency ?? null,
        documentKey: null,
        createdBy: actorId,
        updatedBy: actorId,
      });

      const saved = await tx.save(employee);
      this.log.log(`Colaborador ${saved.employeeNumber} criado em onboarding.`);
      return toFullDto(saved);
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateEmployee,
  ): Promise<Employee> {
    return this.db.transaction(async (tx) => {
      const employee = await tx.findOne(EmployeeEntity, { where: { id, tenantId } });
      if (!employee) throw new NotFoundException(`Colaborador ${id} não encontrado.`);
      if (employee.status === 'terminated') {
        throw new ConflictException(
          'O cadastro de um colaborador desligado é histórico e não pode ser alterado.',
        );
      }

      Object.assign(employee, {
        firstName: dto.firstName ?? employee.firstName,
        lastName: dto.lastName ?? employee.lastName,
        personalEmail: dto.personalEmail ?? employee.personalEmail,
        phone: dto.phone ?? employee.phone,
        jobTitle: dto.jobTitle ?? employee.jobTitle,
        departmentId: dto.departmentId ?? employee.departmentId,
        managerId: dto.managerId ?? employee.managerId,
        salaryMinor: dto.salary?.amountMinor ?? employee.salaryMinor,
        salaryCurrency: dto.salary?.currency ?? employee.salaryCurrency,
        updatedBy: actorId,
      });

      await tx.save(employee);
      return toFullDto(employee);
    });
  }

  async activate(tenantId: string, actorId: string, id: string): Promise<Employee> {
    return this.db.transaction(async (tx) => {
      const employee = await this.lockOne(tx, tenantId, id);
      this.assertTransition(employee.status, 'active');

      employee.status = 'active';
      employee.updatedBy = actorId;
      await tx.save(employee);

      await this.enqueue(tx, employee, 'hr.employee.hired', {
        employeeId: employee.id,
        personName: `${employee.firstName} ${employee.lastName}`,
        departmentId: employee.departmentId,
        startDate: employee.startDate,
      }, actorId);

      return toFullDto(employee);
    });
  }

  async offboard(
    tenantId: string,
    actorId: string,
    id: string,
    dto: OffboardEmployee,
  ): Promise<Employee> {
    return this.db.transaction(async (tx) => {
      const employee = await this.lockOne(tx, tenantId, id);
      this.assertTransition(employee.status, 'terminated');

      employee.status = 'terminated';
      employee.endDate = dto.lastDay;
      employee.updatedBy = actorId;
      await tx.save(employee);

      // Financial listens for this to stop recurring charges; legal listens to
      // flag contracts that named this person.
      await this.enqueue(tx, employee, 'hr.employee.offboarded', {
        employeeId: employee.id,
        lastDay: dto.lastDay,
        reason: dto.reason,
      }, actorId);

      this.log.log(`Colaborador ${employee.employeeNumber} desligado em ${dto.lastDay}.`);
      return toFullDto(employee);
    });
  }

  // --- helpers -------------------------------------------------------------

  private async lockOne(tx: EntityManager, tenantId: string, id: string): Promise<EmployeeEntity> {
    const e = await tx.findOne(EmployeeEntity, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!e) throw new NotFoundException(`Colaborador ${id} não encontrado.`);
    return e;
  }

  private assertTransition(from: EmploymentStatus, to: EmploymentStatus): void {
    if (!TRANSITIONS[from].includes(to)) {
      throw new ConflictException(
        `Transição inválida: "${from}" não pode ir para "${to}". ` +
          `Possíveis: ${TRANSITIONS[from].join(', ') || 'nenhuma'}.`,
      );
    }
  }

  /** Serialised per tenant — see the note in financial-svc's nextNumber. */
  private async nextNumber(tx: EntityManager, tenantId: string): Promise<string> {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`employees:${tenantId}`]);
    const [row] = (await tx.query(
      `SELECT employee_number FROM employees
        WHERE tenant_id = $1 ORDER BY employee_number DESC LIMIT 1`,
      [tenantId],
    )) as Array<{ employee_number: string }>;
    const last = row ? Number(row.employee_number.replace(/\D/g, '')) : 0;
    return `COL-${String(last + 1).padStart(5, '0')}`;
  }

  private async enqueue(
    tx: EntityManager,
    employee: EmployeeEntity,
    type: string,
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    await tx.insert(OutboxEntity, {
      id: randomUUID(),
      aggregateType: 'employee',
      aggregateId: employee.id,
      type,
      // TypeORM's QueryDeepPartialEntity walks object properties looking for
      // nested entities; a jsonb column is opaque data, so it has to be told
      // to store the object as-is.
      payload: payload as never,
      tenantId: employee.tenantId,
      actorId,
      correlationId: correlationId(),
      attempts: 0,
      publishedAt: null,
      lastError: null,
    });
  }
}

// --- mapping ---------------------------------------------------------------

function base(e: EmployeeEntity) {
  return {
    id: e.id,
    tenantId: e.tenantId,
    employeeNumber: e.employeeNumber,
    userId: e.userId,
    firstName: e.firstName,
    lastName: e.lastName,
    workEmail: e.workEmail,
    phone: e.phone,
    status: e.status,
    contractType: e.contractType as never,
    jobTitle: e.jobTitle,
    departmentId: e.departmentId,
    managerId: e.managerId,
    startDate: e.startDate,
    endDate: e.endDate,
    documentKey: e.documentKey,
    createdAt: e.createdAt.toISOString(),
    createdBy: e.createdBy,
    updatedAt: e.updatedAt.toISOString(),
    updatedBy: e.updatedBy,
  };
}

/** Projection for callers without hr:payroll:read — PII is absent, not nulled. */
function toSafeDto(e: EmployeeEntity): EmployeeSafe {
  const { phone: _phone, ...rest } = base(e);
  return rest as EmployeeSafe;
}

function toFullDto(e: EmployeeEntity): Employee {
  return {
    ...base(e),
    personalEmail: e.personalEmail,
    dateOfBirth: e.dateOfBirth,
    // Loaded separately by findOne(); list responses never decrypt it.
    nationalId: null,
    address: e.address as never,
    salary:
      e.salaryMinor !== null && e.salaryCurrency
        ? { amountMinor: e.salaryMinor, currency: e.salaryCurrency }
        : null,
  } as Employee;
}

function rawToFullDto(row: Record<string, unknown>): Employee {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    employeeNumber: row.employee_number as string,
    userId: (row.user_id as string) ?? null,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    workEmail: row.work_email as string,
    personalEmail: (row.personal_email as string) ?? null,
    phone: (row.phone as string) ?? null,
    dateOfBirth: (row.date_of_birth as string) ?? null,
    nationalId: (row.national_id as string) ?? null,
    address: (row.address as never) ?? null,
    status: row.status as EmploymentStatus,
    contractType: row.contract_type as never,
    jobTitle: row.job_title as string,
    departmentId: (row.department_id as string) ?? null,
    managerId: (row.manager_id as string) ?? null,
    startDate: row.start_date as string,
    endDate: (row.end_date as string) ?? null,
    salary:
      row.salary_minor !== null && row.salary_currency
        ? { amountMinor: Number(row.salary_minor), currency: row.salary_currency as string }
        : null,
    documentKey: (row.document_key as string) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    createdBy: (row.created_by as string) ?? null,
    updatedAt: new Date(row.updated_at as string).toISOString(),
    updatedBy: (row.updated_by as string) ?? null,
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
