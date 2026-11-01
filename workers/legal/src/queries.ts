import { money, type Contract, type ContractFilter, type PageQuery } from '@ssm/contracts';

export interface ContractRow {
  id: string;
  tenant_id: string;
  reference: string;
  title: string;
  kind: string;
  status: string;
  parties: string;
  governing_law: string | null;
  jurisdiction: string | null;
  effective_from: string | null;
  effective_to: string | null;
  renewal_notice_days: number;
  auto_renew: number;
  value_minor: number | null;
  value_currency: string | null;
  risk: string | null;
  tags: string;
  current_version: number;
  clauses: string;
  obligations: string;
  document_key: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export async function listContracts(
  db: D1Database,
  tenantId: string,
  filter: ContractFilter,
  page: PageQuery,
): Promise<{ rows: ContractRow[]; nextCursor: string | null }> {
  const where: string[] = ['c.tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (filter.status) {
    where.push('c.status = ?');
    params.push(filter.status);
  }
  if (filter.kind) {
    where.push('c.kind = ?');
    params.push(filter.kind);
  }
  if (filter.risk) {
    where.push('c.risk = ?');
    params.push(filter.risk);
  }
  if (filter.tag) {
    // As etiquetas são um array JSON; `json_each` é o equivalente do `$in` do
    // Mongo, e evita o `LIKE '%tag%'` que casaria "fiscal" dentro de
    // "fiscalizacao".
    where.push('EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value = ?)');
    params.push(filter.tag);
  }
  if (filter.expiringWithinDays) {
    where.push(
      `c.status = 'active' AND c.effective_to IS NOT NULL
       AND c.effective_to >= date('now')
       AND c.effective_to <= date('now', ?)`,
    );
    params.push(`+${filter.expiringWithinDays} days`);
  }
  if (filter.q) {
    where.push('c.rowid IN (SELECT rowid FROM contracts_fts WHERE contracts_fts MATCH ?)');
    params.push(`${filter.q.replace(/["\s]+/g, ' ').trim()}*`);
  }
  if (page.cursor) {
    const { createdAt, id } = decodeCursor(page.cursor);
    where.push('(c.created_at < ? OR (c.created_at = ? AND c.id < ?))');
    params.push(createdAt, createdAt, id);
  }

  const { results } = await db
    .prepare(
      `SELECT c.* FROM contracts c
        WHERE ${where.join(' AND ')}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ?`,
    )
    .bind(...params, page.limit + 1)
    .all<ContractRow>();

  const hasMore = results.length > page.limit;
  const rows = hasMore ? results.slice(0, page.limit) : results;
  const last = rows[rows.length - 1];
  return { rows, nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null };
}

export async function findContractRow(
  db: D1Database,
  tenantId: string,
  id: string,
): Promise<ContractRow | null> {
  return db
    .prepare('SELECT * FROM contracts WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<ContractRow>();
}

export function toDto(r: ContractRow): Contract {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    reference: r.reference,
    title: r.title,
    kind: r.kind as Contract['kind'],
    status: r.status as Contract['status'],
    parties: JSON.parse(r.parties) as Contract['parties'],
    governingLaw: r.governing_law,
    jurisdiction: r.jurisdiction,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    renewalNoticeDays: r.renewal_notice_days,
    // SQLite não tem booleano: a coluna é 0 ou 1, e o CHECK garante que seja.
    autoRenew: r.auto_renew === 1,
    value:
      r.value_minor !== null && r.value_currency ? money(r.value_minor, r.value_currency) : null,
    risk: r.risk as Contract['risk'],
    tags: JSON.parse(r.tags) as string[],
    currentVersion: r.current_version,
    clauses: JSON.parse(r.clauses) as Contract['clauses'],
    obligations: JSON.parse(r.obligations) as Contract['obligations'],
    documentKey: r.document_key,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

export function encodeCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = atob(cursor.replace(/-/g, '+').replace(/_/g, '/')).split('|');
  if (!createdAt || !id) throw new Error('Cursor de paginação inválido.');
  return { createdAt, id };
}
