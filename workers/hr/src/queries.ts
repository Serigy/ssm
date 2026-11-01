import { money, type Employee, type EmployeeFilter, type EmployeeSafe, type Page, type PageQuery } from '@ssm/contracts';
import type { BaseBindings, Database } from '@ssm/worker-common';
import { decryptPii } from './pii.js';

export interface EmployeeRow {
  id: string;
  tenant_id: string;
  employee_number: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  work_email: string;
  personal_email: string | null;
  phone: string | null;
  /** date: texto AAAA-MM-DD. */
  date_of_birth: string | null;
  national_id_enc: string | null;
  /** jsonb: o driver já devolve o objeto. */
  address: Employee['address'];
  status: string;
  contract_type: string;
  job_title: string;
  department_id: string | null;
  manager_id: string | null;
  start_date: string;
  end_date: string | null;
  /** bigint em menor unidade; a camada o devolve como número. */
  salary_minor: number | null;
  salary_currency: string | null;
  document_key: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export async function listEmployees(
  db: Database,
  tenantId: string,
  filter: EmployeeFilter,
  page: PageQuery,
): Promise<{ rows: EmployeeRow[]; nextCursor: string | null }> {
  const where: string[] = ['e.tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (filter.status) {
    where.push('e.status = ?');
    params.push(filter.status);
  }
  if (filter.departmentId) {
    where.push('e.department_id = ?');
    params.push(filter.departmentId);
  }
  if (filter.managerId) {
    where.push('e.manager_id = ?');
    params.push(filter.managerId);
  }
  if (filter.q) {
    const query = searchQuery(filter.q);
    if (query) {
      where.push(`e.search @@ to_tsquery('simple', ?)`);
      params.push(query);
    }
  }
  if (page.cursor) {
    const { createdAt, id } = decodeCursor(page.cursor);
    where.push('(e.created_at < ? OR (e.created_at = ? AND e.id < ?))');
    params.push(createdAt, createdAt, id);
  }

  const { results } = await db
    .prepare(
      `SELECT e.* FROM employees e
        WHERE ${where.join(' AND ')}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ?`,
    )
    .bind(...params, page.limit + 1)
    .all<EmployeeRow>();

  const hasMore = results.length > page.limit;
  const rows = hasMore ? results.slice(0, page.limit) : results;
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function findEmployeeRow(
  db: Database,
  tenantId: string,
  id: string,
): Promise<EmployeeRow | null> {
  return db
    .prepare('SELECT * FROM employees WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, id)
    .first<EmployeeRow>();
}

/**
 * Projeção para quem NÃO tem hr:payroll:read.
 *
 * Os campos sensíveis são omitidos, não anulados: quem chama consegue
 * distinguir "você não pode ver isto" de "isto não está preenchido". O CPF
 * cifrado nem é decifrado neste caminho — a chave não chega a ser usada para
 * um dado que a resposta não vai carregar.
 */
export function toSafeDto(r: EmployeeRow): EmployeeSafe {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    employeeNumber: r.employee_number,
    userId: r.user_id,
    firstName: r.first_name,
    lastName: r.last_name,
    workEmail: r.work_email,
    status: r.status as Employee['status'],
    contractType: r.contract_type as Employee['contractType'],
    jobTitle: r.job_title,
    departmentId: r.department_id,
    managerId: r.manager_id,
    startDate: r.start_date,
    endDate: r.end_date,
    documentKey: r.document_key,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

export async function toFullDto(env: BaseBindings, r: EmployeeRow): Promise<Employee> {
  return {
    ...toSafeDto(r),
    personalEmail: r.personal_email,
    phone: r.phone,
    dateOfBirth: r.date_of_birth,
    nationalId: await decryptPii(env, r.national_id_enc, r.id),
    address: r.address ?? null,
    salary:
      r.salary_minor !== null && r.salary_currency
        ? money(r.salary_minor, r.salary_currency)
        : null,
  };
}

/**
 * Texto digitado -> tsquery de prefixo, na mesma dobra de acento da coluna
 * `search` ("alvaro" acha "Álvaro"). Só letras e dígitos sobrevivem, então o
 * valor não carrega operador de tsquery; ainda assim vai como parâmetro.
 * Devolve null quando não sobra nenhum termo.
 */
export function searchQuery(input: string): string | null {
  const terms = input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return terms.length ? terms.map((t) => `${t}:*`).join(' & ') : null;
}

export function encodeCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = atob(cursor.replace(/-/g, '+').replace(/_/g, '/')).split('|');
  if (!createdAt || !id) throw new Error('Cursor de paginação inválido.');
  return { createdAt, id };
}

export type EmployeePage = Page<Employee | EmployeeSafe>;
