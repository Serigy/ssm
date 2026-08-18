import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes invoice search use an index.
 *
 * `InvoicesService.list` matches a term against the invoice number and the
 * counterparty name. The leading wildcard in `ILIKE '%termo%'` makes a B-tree
 * useless — a B-tree is ordered by prefix and there is no prefix here — so
 * every keystroke in the search box was a sequential scan of the whole table.
 *
 * Two extensions, both required:
 *
 *   pg_trgm    indexes the three-character sequences of a string, which is what
 *              lets a substring match be answered from an index at all.
 *   btree_gin  lets a scalar column sit in the same GIN index as the trigram
 *              expression, so tenant_id stays inside the index instead of
 *              becoming a separate bitmap Postgres has to combine.
 *
 * ## Why an expression over the concatenation, and not one index per column
 *
 * The first attempt indexed the columns separately inside one multicolumn GIN
 * index. Measured on 60k rows, it was never chosen: a multicolumn GIN index
 * answers `a AND b`, while the query asks `a OR b`. The planner kept the
 * sequential scan, correctly.
 *
 * Indexing `number || ' ' || counterparty_name` turns the OR into a single
 * predicate that one index serves. The query in InvoicesService must use the
 * identical expression, or the planner will not match it — the two are a pair
 * and neither can change alone.
 *
 * Measured, same 60k rows, selective term: 52 ms sequential scan -> 4 ms bitmap
 * index scan.
 *
 * COALESCE matters: `number` is null while an invoice is a draft, and in SQL
 * `null || 'x'` is null, which would silently drop every draft from search.
 */
export class InvoiceSearchIndex1747100000000 implements MigrationInterface {
  name = 'InvoiceSearchIndex1747100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS btree_gin`);

    // NOTE for a populated table: this takes an ACCESS EXCLUSIVE lock and
    // blocks writes while it builds. In production use CREATE INDEX
    // CONCURRENTLY, which cannot run inside a transaction and so needs its own
    // migration with the transaction disabled. At current volumes this is
    // milliseconds.
    await q.query(`
      CREATE INDEX invoices_search_trgm_idx ON invoices USING gin (
        tenant_id,
        (coalesce(number, '') || ' ' || coalesce(counterparty_name, '')) gin_trgm_ops
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS invoices_search_trgm_idx`);
    // Extensions are left in place. Another table may depend on them, and
    // dropping a shared extension on rollback is a blast radius a rollback
    // should never have.
  }
}
