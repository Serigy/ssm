import type { Database } from '@ssm/worker-common';
import type {
  Environment,
  EnvironmentFilter,
  PageQuery,
  Ticket,
  TicketFilter,
} from '@ssm/contracts';

export interface TicketRow {
  id: string;
  tenant_id: string;
  number: number;
  subject: string;
  description: string;
  kind: string;
  severity: string;
  status: string;
  environment_id: string | null;
  environment_code: string | null;
  assignee_id: string | null;
  opened_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  response_due_at: string;
  response_breached: boolean;
  paused_minutes: number;
  waiting_since: string | null;
  /** jsonb: o driver já devolve o array. */
  timeline: Ticket['timeline'];
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface EnvironmentRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  kind: string;
  status: string;
  region: string | null;
  provider: string | null;
  contract_ref: string | null;
  availability_target_bps: number;
  response_sev1_minutes: number;
  response_sev2_minutes: number;
  response_sev3_minutes: number;
  /** jsonb: o driver já devolve o array/objeto. */
  tags: string[];
  next_window: Environment['nextWindow'];
  notes: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export async function listTickets(
  db: Database,
  tenantId: string,
  filter: TicketFilter,
  page: PageQuery,
): Promise<{ rows: TicketRow[]; nextCursor: string | null }> {
  const where: string[] = ['t.tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (filter.status) {
    where.push('t.status = ?');
    params.push(filter.status);
  }
  if (filter.severity) {
    where.push('t.severity = ?');
    params.push(filter.severity);
  }
  if (filter.environmentId) {
    where.push('t.environment_id = ?');
    params.push(filter.environmentId);
  }
  if (filter.assigneeId) {
    where.push('t.assignee_id = ?');
    params.push(filter.assigneeId);
  }
  if (filter.breached) {
    // Descumprido é o que já foi marcado E o que ainda vai ser: um chamado
    // aberto cujo prazo passou sem resposta está descumprido agora, mesmo que
    // a marca só entre quando alguém finalmente responder.
    where.push(
      `(t.response_breached
        OR (t.first_response_at IS NULL AND t.response_due_at < now()))`,
    );
  }
  if (filter.q) {
    const query = searchQuery(filter.q);
    if (query) {
      where.push(`t.search @@ to_tsquery('simple', ?)`);
      params.push(query);
    }
  }
  if (page.cursor) {
    const { createdAt, id } = decodeCursor(page.cursor);
    where.push('(t.created_at < ? OR (t.created_at = ? AND t.id < ?))');
    params.push(createdAt, createdAt, id);
  }

  const { results } = await db
    .prepare(
      `SELECT t.* FROM tickets t
        WHERE ${where.join(' AND ')}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ?`,
    )
    .bind(...params, page.limit + 1)
    .all<TicketRow>();

  const hasMore = results.length > page.limit;
  const rows = hasMore ? results.slice(0, page.limit) : results;
  const last = rows[rows.length - 1];
  return { rows, nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null };
}

export async function findTicketRow(
  db: Database,
  tenantId: string,
  id: string,
): Promise<TicketRow | null> {
  return db
    .prepare('SELECT * FROM tickets WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, id)
    .first<TicketRow>();
}

export async function listEnvironments(
  db: Database,
  tenantId: string,
  filter: EnvironmentFilter,
): Promise<EnvironmentRow[]> {
  const where: string[] = ['tenant_id = ?'];
  const params: unknown[] = [tenantId];
  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.kind) {
    where.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.q) {
    where.push('(code LIKE ? OR name LIKE ?)');
    params.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  const { results } = await db
    .prepare(`SELECT * FROM environments WHERE ${where.join(' AND ')} ORDER BY code`)
    .bind(...params)
    .all<EnvironmentRow>();
  return results;
}

export async function findEnvironmentRow(
  db: Database,
  tenantId: string,
  id: string,
): Promise<EnvironmentRow | null> {
  return db
    .prepare('SELECT * FROM environments WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, id)
    .first<EnvironmentRow>();
}

export function toTicketDto(t: TicketRow): Ticket {
  return {
    id: t.id,
    tenantId: t.tenant_id,
    number: t.number,
    subject: t.subject,
    description: t.description,
    kind: t.kind as Ticket['kind'],
    severity: t.severity as Ticket['severity'],
    status: t.status as Ticket['status'],
    environmentId: t.environment_id,
    environmentCode: t.environment_code,
    assigneeId: t.assignee_id,
    openedAt: t.opened_at,
    firstResponseAt: t.first_response_at,
    resolvedAt: t.resolved_at,
    closedAt: t.closed_at,
    responseDueAt: t.response_due_at,
    responseBreached: t.response_breached,
    pausedMinutes: t.paused_minutes,
    timeline: t.timeline,
    createdAt: t.created_at,
    createdBy: t.created_by,
    updatedAt: t.updated_at,
    updatedBy: t.updated_by,
  };
}

export function toEnvironmentDto(e: EnvironmentRow): Environment {
  return {
    id: e.id,
    tenantId: e.tenant_id,
    code: e.code,
    name: e.name,
    kind: e.kind as Environment['kind'],
    status: e.status as Environment['status'],
    region: e.region,
    provider: e.provider,
    contractRef: e.contract_ref,
    availabilityTargetBps: e.availability_target_bps,
    responseTargetMinutes: {
      sev1: e.response_sev1_minutes,
      sev2: e.response_sev2_minutes,
      sev3: e.response_sev3_minutes,
    },
    tags: e.tags,
    nextWindow: e.next_window ?? null,
    notes: e.notes,
    createdAt: e.created_at,
    createdBy: e.created_by,
    updatedAt: e.updated_at,
    updatedBy: e.updated_by,
  };
}

/**
 * Texto digitado -> tsquery de prefixo, na mesma dobra de acento da coluna
 * `search`. Só letras e dígitos sobrevivem, então o valor não carrega operador
 * de tsquery; ainda assim vai como parâmetro. null quando não sobra termo.
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
