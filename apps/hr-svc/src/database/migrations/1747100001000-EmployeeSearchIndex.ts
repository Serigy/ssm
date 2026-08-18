import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes employee search use an index — same reasoning as the invoice one, in
 * apps/financial-svc/src/database/migrations/1747100000000.
 *
 * Four columns here rather than two, which makes the case against per-column
 * indexes stronger still: a BitmapOr across four separate index scans is
 * expensive enough that the planner would often prefer the sequential scan
 * anyway. One expression, one index, one scan.
 */
export class EmployeeSearchIndex1747100001000 implements MigrationInterface {
  name = 'EmployeeSearchIndex1747100001000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS btree_gin`);

    await q.query(`
      CREATE INDEX employees_search_trgm_idx ON employees USING gin (
        tenant_id,
        (
          coalesce(first_name, '') || ' ' ||
          coalesce(last_name, '') || ' ' ||
          coalesce(work_email, '') || ' ' ||
          coalesce(employee_number, '')
        ) gin_trgm_ops
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS employees_search_trgm_idx`);
  }
}
