import { money, type Invoice, type InvoiceFilter, type Page, type PageQuery } from '@ssm/contracts';

/**
 * Consultas em SQL literal, sem ORM.
 *
 * O TypeORM não fala com D1, e o D1 não tem transação interativa — o padrão
 * `SELECT ... FOR UPDATE` seguido de escrita simplesmente não existe. Em vez de
 * trocar um ORM por outro, as consultas ficam explícitas: o que é executado é o
 * que está escrito, e o `batch()` atômico do D1 fica visível no lugar onde
 * importa.
 */

interface InvoiceRow {
  id: string;
  tenant_id: string;
  number: string | null;
  status: string;
  counterparty_id: string;
  counterparty_name: string;
  issue_date: string | null;
  due_date: string;
  currency: string;
  subtotal_minor: number;
  tax_total_minor: number;
  total_minor: number;
  amount_paid_minor: number;
  notes: string | null;
  document_key: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

interface LineRow {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  quantity_milli: number;
  unit_price_minor: number;
  tax_rate_bps: number;
  line_total_minor: number;
}

export async function listInvoices(
  db: D1Database,
  tenantId: string,
  filter: InvoiceFilter,
  page: PageQuery,
): Promise<Page<Invoice>> {
  // O escopo por cliente é o primeiro predicado, sempre — a mesma regra do
  // serviço em NestJS, pelo mesmo motivo.
  const where: string[] = ['i.tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (filter.status) {
    where.push('i.status = ?');
    params.push(filter.status);
  }
  if (filter.counterpartyId) {
    where.push('i.counterparty_id = ?');
    params.push(filter.counterpartyId);
  }
  if (filter.dueBefore) {
    where.push('i.due_date <= ?');
    params.push(filter.dueBefore);
  }
  if (filter.dueAfter) {
    where.push('i.due_date >= ?');
    params.push(filter.dueAfter);
  }
  if (filter.q) {
    // FTS5 no lugar do pg_trgm. Casa por termo, não por trecho dentro de
    // palavra — a perda está registrada em workers/migrations/financial.
    where.push('i.rowid IN (SELECT rowid FROM invoices_fts WHERE invoices_fts MATCH ?)');
    params.push(`${filter.q.replace(/["\s]+/g, ' ').trim()}*`);
  }

  // Paginação por chave, como antes: OFFSET faz linha aparecer em duas páginas
  // quando há inserção concorrente.
  if (page.cursor) {
    const { createdAt, id } = decodeCursor(page.cursor);
    where.push('(i.created_at < ? OR (i.created_at = ? AND i.id < ?))');
    params.push(createdAt, createdAt, id);
  }

  const { results } = await db
    .prepare(
      `SELECT i.* FROM invoices i
        WHERE ${where.join(' AND ')}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT ?`,
    )
    .bind(...params, page.limit + 1)
    .all<InvoiceRow>();

  const hasMore = results.length > page.limit;
  const rows = hasMore ? results.slice(0, page.limit) : results;
  if (rows.length === 0) return { items: [], nextCursor: null };

  // As linhas vêm em uma consulta só: N+1 num Worker custa N idas ao D1, cada
  // uma com latência de rede, dentro do orçamento de CPU da requisição.
  const placeholders = rows.map(() => '?').join(',');
  const { results: lines } = await db
    .prepare(
      `SELECT * FROM invoice_lines WHERE invoice_id IN (${placeholders}) ORDER BY position`,
    )
    .bind(...rows.map((r) => r.id))
    .all<LineRow>();

  const byInvoice = new Map<string, LineRow[]>();
  for (const line of lines) {
    const list = byInvoice.get(line.invoice_id) ?? [];
    list.push(line);
    byInvoice.set(line.invoice_id, list);
  }

  const last = rows[rows.length - 1]!;
  return {
    items: rows.map((r) => toDto(r, byInvoice.get(r.id) ?? [])),
    nextCursor: hasMore ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function findInvoice(
  db: D1Database,
  tenantId: string,
  id: string,
): Promise<Invoice | null> {
  const row = await db
    .prepare('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId)
    .first<InvoiceRow>();
  if (!row) return null;

  const { results: lines } = await db
    .prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position')
    .bind(id)
    .all<LineRow>();

  return toDto(row, lines);
}

function toDto(r: InvoiceRow, lines: LineRow[]): Invoice {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    number: r.number,
    status: r.status as Invoice['status'],
    counterpartyId: r.counterparty_id,
    counterpartyName: r.counterparty_name,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    currency: r.currency,
    lines: lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantityMilli: l.quantity_milli,
      unitPrice: money(l.unit_price_minor, r.currency),
      taxRateBps: l.tax_rate_bps,
      lineTotal: money(l.line_total_minor, r.currency),
    })),
    subtotal: money(r.subtotal_minor, r.currency),
    taxTotal: money(r.tax_total_minor, r.currency),
    total: money(r.total_minor, r.currency),
    amountPaid: money(r.amount_paid_minor, r.currency),
    notes: r.notes ?? undefined,
    documentKey: r.document_key,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = atob(cursor.replace(/-/g, '+').replace(/_/g, '/')).split('|');
  if (!createdAt || !id) throw new Error('Cursor de paginação inválido.');
  return { createdAt, id };
}
