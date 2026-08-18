import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for financial-svc.
 *
 * Written by hand rather than generated, so that the index definitions and the
 * money column types are deliberate. Money is `bigint` minor units plus a
 * `char(3)` code — never `numeric`, never `double precision`.
 */
export class InitFinancial1747000000000 implements MigrationInterface {
  name = 'InitFinancial1747000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await q.query(`
      CREATE TABLE invoices (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid        NOT NULL,
        number             varchar(32),
        status             varchar(24) NOT NULL DEFAULT 'draft',
        counterparty_id    uuid        NOT NULL,
        counterparty_name  varchar(200) NOT NULL,
        issue_date         date,
        due_date           date        NOT NULL,
        currency           char(3)     NOT NULL,
        subtotal_minor     bigint      NOT NULL DEFAULT 0,
        tax_total_minor    bigint      NOT NULL DEFAULT 0,
        total_minor        bigint      NOT NULL DEFAULT 0,
        amount_paid_minor  bigint      NOT NULL DEFAULT 0,
        notes              text,
        document_key       text,
        version            int         NOT NULL DEFAULT 1,
        created_at         timestamptz NOT NULL DEFAULT now(),
        created_by         uuid,
        updated_at         timestamptz NOT NULL DEFAULT now(),
        updated_by         uuid,

        CONSTRAINT invoices_status_chk CHECK (
          status IN ('draft','issued','partially_paid','paid','void')
        ),
        -- A paid amount above the total means a bug upstream; refuse to store it.
        CONSTRAINT invoices_paid_chk CHECK (amount_paid_minor BETWEEN 0 AND total_minor),
        -- An issued invoice must carry a number and an issue date, always.
        CONSTRAINT invoices_issued_chk CHECK (
          status = 'draft' OR (number IS NOT NULL AND issue_date IS NOT NULL)
        )
      )
    `);

    await q.query(`
      CREATE TABLE invoice_lines (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id        uuid   NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        position          int    NOT NULL,
        description       varchar(500) NOT NULL,
        quantity_milli    bigint NOT NULL,
        unit_price_minor  bigint NOT NULL,
        tax_rate_bps      int    NOT NULL DEFAULT 0,
        line_total_minor  bigint NOT NULL,

        CONSTRAINT invoice_lines_qty_chk CHECK (quantity_milli > 0),
        CONSTRAINT invoice_lines_tax_chk CHECK (tax_rate_bps BETWEEN 0 AND 10000),
        CONSTRAINT invoice_lines_pos_uq UNIQUE (invoice_id, position)
      )
    `);

    // Leading with tenant_id is what keeps per-tenant queries index-only.
    await q.query(`
      CREATE INDEX invoices_tenant_status_idx
        ON invoices (tenant_id, status, due_date)
    `);
    await q.query(`
      CREATE UNIQUE INDEX invoices_tenant_number_uq
        ON invoices (tenant_id, number) WHERE number IS NOT NULL
    `);
    await q.query(`CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id)`);

    await q.query(`
      CREATE TABLE outbox (
        id              uuid PRIMARY KEY,
        aggregate_type  text        NOT NULL,
        aggregate_id    uuid        NOT NULL,
        type            text        NOT NULL,
        payload         jsonb       NOT NULL,
        tenant_id       uuid        NOT NULL,
        actor_id        uuid,
        correlation_id  uuid        NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        published_at    timestamptz,
        attempts        int         NOT NULL DEFAULT 0,
        last_error      text
      )
    `);
    // Partial index: the relay only ever reads unpublished rows, so the index
    // stays small no matter how much history the table accumulates.
    await q.query(`
      CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS outbox`);
    await q.query(`DROP TABLE IF EXISTS invoice_lines`);
    await q.query(`DROP TABLE IF EXISTS invoices`);
  }
}
