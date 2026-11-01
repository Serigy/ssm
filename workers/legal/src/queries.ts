import type { Database } from '@ssm/worker-common';
import { money, type Contract, type ContractFilter, type PageQuery } from '@ssm/contracts';

export interface ContractRow {
  id: string;
  tenant_id: string;
  reference: string;
  title: string;
  kind: string;
  status: string;
  /** jsonb: o driver já devolve o array/objeto, sem JSON.parse. */
  parties: Contract['parties'];
  governing_law: string | null;
  jurisdiction: string | null;
  /** date: texto AAAA-MM-DD. */
  effective_from: string | null;
  effective_to: string | null;
  renewal_notice_days: number;
  auto_renew: boolean;
  /** bigint em menor unidade; a camada o devolve como número. */
  value_minor: number | null;
  value_currency: string | null;
  risk: string | null;
  tags: string[];
  current_version: number;
  clauses: Contract['clauses'];
  obligations: Contract['obligations'];
  document_key: string | null;
  /** date: a data de fim para a qual o aviso de vencimento já saiu. */
  expiry_notice_sent_for: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export async function listContracts(
  db: Database,
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
    // As etiquetas são um array jsonb; `@>` (contém, com índice GIN) é o
    // equivalente do `$in` do Mongo, e evita o `LIKE '%tag%'` que casaria
    // "fiscal" dentro de "fiscalizacao". Não é o operador `?` do jsonb, que a
    // camada tomaria por parâmetro.
    where.push('c.tags @> ?::jsonb');
    params.push(JSON.stringify([filter.tag]));
  }
  if (filter.expiringWithinDays) {
    where.push(
      `c.status = 'active' AND c.effective_to IS NOT NULL
       AND c.effective_to >= current_date
       AND c.effective_to <= current_date + (?)::integer`,
    );
    params.push(filter.expiringWithinDays);
  }
  if (filter.q) {
    const query = searchQuery(filter.q);
    if (query) {
      where.push(`c.search @@ to_tsquery('simple', ?)`);
      params.push(query);
    }
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
  db: Database,
  tenantId: string,
  id: string,
): Promise<ContractRow | null> {
  return db
    .prepare('SELECT * FROM contracts WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, id)
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
    parties: r.parties,
    governingLaw: r.governing_law,
    jurisdiction: r.jurisdiction,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    renewalNoticeDays: r.renewal_notice_days,
    autoRenew: r.auto_renew,
    value:
      r.value_minor !== null && r.value_currency ? money(r.value_minor, r.value_currency) : null,
    risk: r.risk as Contract['risk'],
    tags: r.tags,
    currentVersion: r.current_version,
    clauses: r.clauses,
    obligations: r.obligations,
    documentKey: r.document_key,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
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
