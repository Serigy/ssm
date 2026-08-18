import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitHr1747000001000 implements MigrationInterface {
  name = 'InitHr1747000001000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await q.query(`
      CREATE TABLE departments (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL,
        name              varchar(200) NOT NULL,
        parent_id         uuid REFERENCES departments(id) ON DELETE SET NULL,
        head_employee_id  uuid,
        created_at        timestamptz NOT NULL DEFAULT now(),
        created_by        uuid,
        updated_at        timestamptz NOT NULL DEFAULT now(),
        updated_by        uuid
      )
    `);

    await q.query(`
      CREATE TABLE employees (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        uuid NOT NULL,
        employee_number  varchar(32) NOT NULL,
        user_id          uuid,
        first_name       varchar(100) NOT NULL,
        last_name        varchar(100) NOT NULL,
        work_email       varchar(320) NOT NULL,
        personal_email   varchar(320),
        phone            varchar(40),
        date_of_birth    date,
        -- Encrypted with pgcrypto; the key lives in the secrets volume, so a
        -- leaked base backup does not leak national ids.
        national_id_enc  bytea,
        address          jsonb,
        status           varchar(24) NOT NULL DEFAULT 'onboarding',
        contract_type    varchar(24) NOT NULL,
        job_title        varchar(200) NOT NULL,
        department_id    uuid REFERENCES departments(id) ON DELETE SET NULL,
        manager_id       uuid REFERENCES employees(id) ON DELETE SET NULL,
        start_date       date NOT NULL,
        end_date         date,
        salary_minor     bigint,
        salary_currency  char(3),
        document_key     text,
        created_at       timestamptz NOT NULL DEFAULT now(),
        created_by       uuid,
        updated_at       timestamptz NOT NULL DEFAULT now(),
        updated_by       uuid,

        CONSTRAINT employees_status_chk CHECK (
          status IN ('applicant','onboarding','active','on_leave','offboarding','terminated')
        ),
        -- Salary is meaningless without its currency, and vice versa.
        CONSTRAINT employees_salary_chk CHECK (
          (salary_minor IS NULL) = (salary_currency IS NULL)
        ),
        -- A terminated employee must have a last day recorded.
        CONSTRAINT employees_end_chk CHECK (status <> 'terminated' OR end_date IS NOT NULL),
        CONSTRAINT employees_dates_chk CHECK (end_date IS NULL OR end_date >= start_date)
      )
    `);

    await q.query(`CREATE INDEX employees_tenant_status_idx ON employees (tenant_id, status)`);
    await q.query(
      `CREATE UNIQUE INDEX employees_tenant_number_uq ON employees (tenant_id, employee_number)`,
    );
    await q.query(
      `CREATE UNIQUE INDEX employees_tenant_email_uq ON employees (tenant_id, lower(work_email))`,
    );
    await q.query(`CREATE INDEX departments_tenant_idx ON departments (tenant_id)`);

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
    await q.query(
      `CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS outbox`);
    await q.query(`DROP TABLE IF EXISTS employees`);
    await q.query(`DROP TABLE IF EXISTS departments`);
  }
}
