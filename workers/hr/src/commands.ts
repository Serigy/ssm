import type {
  CreateEmployee,
  Employee,
  EmploymentStatus,
  OffboardEmployee,
  UpdateEmployee,
} from '@ssm/contracts';
import {
  HttpProblem,
  highestNumber,
  withReservedNumber,
  type BaseBindings,
} from '@ssm/worker-common';
import { encryptPii } from './pii.js';
import { findEmployeeRow, toFullDto } from './queries.js';

/**
 * Máquina de estados do vínculo.
 *
 * Difere da do serviço em NestJS em três arestas, porque a de lá tinha um
 * buraco: `active` só ia para `on_leave` e `offboarding`, e não havia endpoint
 * nenhum que levasse a `offboarding`. O resultado é que ninguém que estivesse
 * trabalhando podia ser desligado — a rota existia, respondia 409 e nenhum
 * teste passava por ali. `offboarding` era estado inalcançável.
 *
 * O desligamento agora usa a data do último dia: futura leva a `offboarding`,
 * hoje ou passada leva direto a `terminated`, e a rotina diária promove quem
 * chegou ao último dia. É o que os dois estados existem para representar.
 */
const TRANSITIONS: Record<EmploymentStatus, EmploymentStatus[]> = {
  applicant: ['onboarding', 'terminated'],
  onboarding: ['active', 'offboarding', 'terminated'],
  active: ['on_leave', 'offboarding', 'terminated'],
  on_leave: ['active', 'offboarding', 'terminated'],
  offboarding: ['terminated'],
  terminated: [],
};

export const EMPLOYMENT_TRANSITIONS = TRANSITIONS;

const PREFIX = 'COL-';
const now = () => new Date().toISOString();

export async function createEmployee(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  dto: CreateEmployee,
): Promise<Employee> {
  const duplicate = await env.DB.prepare(
    'SELECT employee_number FROM employees WHERE tenant_id = ? AND lower(work_email) = lower(?)',
  )
    .bind(tenantId, dto.workEmail)
    .first<{ employee_number: string }>();
  if (duplicate) {
    throw HttpProblem.conflict(
      `Já existe um colaborador com o e-mail ${dto.workEmail} (${duplicate.employee_number}).`,
    );
  }

  const seed = await highestNumber(env.DB, 'employees', 'employee_number', tenantId, PREFIX);
  const id = crypto.randomUUID();

  return withReservedNumber(env, tenantId, 'employees', seed, async (value) => {
    const number = `${PREFIX}${String(value).padStart(5, '0')}`;
    await env.DB.prepare(
      `INSERT INTO employees (
         id, tenant_id, employee_number, first_name, last_name, work_email,
         personal_email, phone, date_of_birth, national_id_enc, status,
         contract_type, job_title, department_id, manager_id, start_date,
         salary_minor, salary_currency, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'onboarding', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        tenantId,
        number,
        dto.firstName,
        dto.lastName,
        dto.workEmail,
        dto.personalEmail ?? null,
        dto.phone ?? null,
        dto.dateOfBirth ?? null,
        dto.nationalId ? await encryptPii(env, dto.nationalId) : null,
        dto.contractType,
        dto.jobTitle,
        dto.departmentId ?? null,
        dto.managerId ?? null,
        dto.startDate,
        dto.salary?.amountMinor ?? null,
        dto.salary?.currency ?? null,
        actorId,
        actorId,
      )
      .run();

    const row = await findEmployeeRow(env.DB, tenantId, id);
    if (!row) throw new Error(`Colaborador ${id} desapareceu logo após ser criado.`);
    return toFullDto(env, row);
  });
}

export async function updateEmployee(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  dto: UpdateEmployee,
): Promise<Employee> {
  const row = await findEmployeeRow(env.DB, tenantId, id);
  if (!row) throw HttpProblem.notFound(`Colaborador ${id} não encontrado.`);
  if (row.status === 'terminated') {
    throw HttpProblem.conflict(
      'O cadastro de um colaborador desligado é histórico e não pode ser alterado.',
    );
  }

  // Cada campo ausente no corpo mantém o valor gravado. `?? row.x` e não
  // `dto.x || row.x`: string vazia e zero são valores legítimos que o `||`
  // descartaria.
  await env.DB.prepare(
    `UPDATE employees
        SET first_name = ?, last_name = ?, personal_email = ?, phone = ?,
            date_of_birth = ?, national_id_enc = ?, job_title = ?,
            department_id = ?, manager_id = ?, salary_minor = ?, salary_currency = ?,
            updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`,
  )
    .bind(
      dto.firstName ?? row.first_name,
      dto.lastName ?? row.last_name,
      dto.personalEmail ?? row.personal_email,
      dto.phone ?? row.phone,
      dto.dateOfBirth ?? row.date_of_birth,
      dto.nationalId ? await encryptPii(env, dto.nationalId) : row.national_id_enc,
      dto.jobTitle ?? row.job_title,
      dto.departmentId ?? row.department_id,
      dto.managerId ?? row.manager_id,
      dto.salary?.amountMinor ?? row.salary_minor,
      dto.salary?.currency ?? row.salary_currency,
      actorId,
      now(),
      id,
      tenantId,
    )
    .run();

  return toFullDto(env, (await findEmployeeRow(env.DB, tenantId, id))!);
}

export async function activateEmployee(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  correlationId: string,
): Promise<Employee> {
  const row = await findEmployeeRow(env.DB, tenantId, id);
  if (!row) throw HttpProblem.notFound(`Colaborador ${id} não encontrado.`);
  assertTransition(row.status as EmploymentStatus, 'active');

  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE employees SET status = 'active', updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = ?`,
    ).bind(actorId, now(), id, tenantId, row.status),
    outboxInsert(env, {
      aggregateId: id,
      type: 'hr.employee.activated',
      tenantId,
      actorId,
      correlationId,
      payload: { employeeId: id, employeeNumber: row.employee_number, startDate: row.start_date },
    }),
  ]);

  // O estado é a própria condição do UPDATE, então `changes === 0` significa que
  // outra pessoa mudou a situação entre a leitura e a escrita.
  if (!updated || updated.meta.changes === 0) {
    throw HttpProblem.conflict('A situação do colaborador mudou enquanto era ativada.');
  }

  return toFullDto(env, (await findEmployeeRow(env.DB, tenantId, id))!);
}

export async function offboardEmployee(
  env: BaseBindings,
  tenantId: string,
  actorId: string,
  id: string,
  dto: OffboardEmployee,
  correlationId: string,
): Promise<Employee> {
  const row = await findEmployeeRow(env.DB, tenantId, id);
  if (!row) throw HttpProblem.notFound(`Colaborador ${id} não encontrado.`);

  if (dto.lastDay < row.start_date) {
    // O CHECK do banco recusaria de qualquer forma; recusar aqui devolve 400
    // com explicação em vez de 500 vindo do SQLite.
    throw HttpProblem.badRequest(
      `O último dia (${dto.lastDay}) não pode ser anterior à admissão (${row.start_date}).`,
    );
  }

  // Aviso prévio em curso ou desligamento já consumado — a data decide.
  const today = new Date().toISOString().slice(0, 10);
  const target: EmploymentStatus = dto.lastDay > today ? 'offboarding' : 'terminated';
  assertTransition(row.status as EmploymentStatus, target);

  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE employees SET status = ?, end_date = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = ?`,
    ).bind(target, dto.lastDay, actorId, now(), id, tenantId, row.status),
    outboxInsert(env, {
      aggregateId: id,
      type: 'hr.employee.offboarded',
      tenantId,
      actorId,
      correlationId,
      // O financeiro escuta para parar cobrança recorrente; o jurídico escuta
      // para sinalizar contrato que nomeava esta pessoa. O evento sai quando o
      // desligamento é decidido, não quando o último dia chega: os dois lados
      // precisam do aviso prévio para agir a tempo.
      payload: { employeeId: id, lastDay: dto.lastDay, reason: dto.reason, status: target },
    }),
  ]);

  if (!updated || updated.meta.changes === 0) {
    throw HttpProblem.conflict('A situação do colaborador mudou enquanto era desligada.');
  }

  return toFullDto(env, (await findEmployeeRow(env.DB, tenantId, id))!);
}

/**
 * Promove a `terminated` quem chegou ao último dia.
 *
 * Sem isto `offboarding` seria estado de mão única: a pessoa entraria nele e
 * nunca sairia, e relatório de quadro ativo contaria gente que já foi embora.
 */
export async function terminateOverdue(env: BaseBindings): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const result = await env.DB.prepare(
    `UPDATE employees
        SET status = 'terminated', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE status = 'offboarding' AND end_date IS NOT NULL AND end_date <= ?`,
  )
    .bind(today)
    .run();
  return result.meta.changes;
}

function assertTransition(from: EmploymentStatus, to: EmploymentStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw HttpProblem.conflict(
      `Transição inválida: "${from}" não pode ir para "${to}". ` +
        `Possíveis: ${TRANSITIONS[from].join(', ') || 'nenhuma'}.`,
    );
  }
}

interface OutboxEvent {
  aggregateId: string;
  type: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

function outboxInsert(env: BaseBindings, event: OutboxEvent): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload,
                         tenant_id, actor_id, correlation_id)
     VALUES (?, 'employee', ?, ?, ?, ?, ?, ?)`,
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
