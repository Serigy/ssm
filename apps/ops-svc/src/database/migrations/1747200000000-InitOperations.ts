import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitOperations1747200000000 implements MigrationInterface {
  name = 'InitOperations1747200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS btree_gin`);

    await q.query(`
      CREATE TABLE environments (
        id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id                uuid NOT NULL,
        code                     varchar(40) NOT NULL,
        name                     varchar(200) NOT NULL,
        kind                     varchar(24) NOT NULL,
        status                   varchar(24) NOT NULL DEFAULT 'operational',
        region                   varchar(60),
        provider                 varchar(60),
        contract_ref             varchar(64),
        availability_target_bps  int NOT NULL DEFAULT 9950,
        response_sev1_minutes    int NOT NULL DEFAULT 15,
        response_sev2_minutes    int NOT NULL DEFAULT 60,
        response_sev3_minutes    int NOT NULL DEFAULT 480,
        tags                     text[] NOT NULL DEFAULT '{}',
        next_window              jsonb,
        notes                    text,
        created_at               timestamptz NOT NULL DEFAULT now(),
        created_by               uuid,
        updated_at               timestamptz NOT NULL DEFAULT now(),
        updated_by               uuid,

        CONSTRAINT environments_kind_chk CHECK (
          kind IN ('production','staging','development','data','legacy')
        ),
        CONSTRAINT environments_status_chk CHECK (
          status IN ('operational','incident','scheduled_window','decommissioned')
        ),
        -- An availability target outside 0..100% is a data-entry error that
        -- would silently corrupt every future reckoning.
        CONSTRAINT environments_target_chk CHECK (availability_target_bps BETWEEN 0 AND 10000),
        CONSTRAINT environments_response_chk CHECK (
          response_sev1_minutes > 0 AND response_sev2_minutes > 0 AND response_sev3_minutes > 0
        )
      )
    `);
    await q.query(`CREATE UNIQUE INDEX environments_tenant_code_uq ON environments (tenant_id, code)`);
    await q.query(`CREATE INDEX environments_tenant_status_idx ON environments (tenant_id, status)`);
    await q.query(`
      CREATE INDEX environments_search_trgm_idx ON environments USING gin (
        tenant_id, (coalesce(code, '') || ' ' || coalesce(name, '')) gin_trgm_ops
      )
    `);

    await q.query(`
      CREATE TABLE tickets (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL,
        number             int NOT NULL,
        subject            varchar(300) NOT NULL,
        description        text NOT NULL DEFAULT '',
        kind               varchar(16) NOT NULL DEFAULT 'incident',
        severity           varchar(8) NOT NULL,
        status             varchar(24) NOT NULL DEFAULT 'open',
        environment_id     uuid REFERENCES environments(id) ON DELETE SET NULL,
        environment_code   varchar(40),
        assignee_id        uuid,
        opened_at          timestamptz NOT NULL,
        first_response_at  timestamptz,
        resolved_at        timestamptz,
        closed_at          timestamptz,
        response_due_at    timestamptz NOT NULL,
        response_breached  boolean NOT NULL DEFAULT false,
        paused_minutes     int NOT NULL DEFAULT 0,
        waiting_since      timestamptz,
        timeline           jsonb NOT NULL DEFAULT '[]',
        created_at         timestamptz NOT NULL DEFAULT now(),
        created_by         uuid,
        updated_at         timestamptz NOT NULL DEFAULT now(),
        updated_by         uuid,

        CONSTRAINT tickets_severity_chk CHECK (severity IN ('sev1','sev2','sev3')),
        CONSTRAINT tickets_status_chk CHECK (
          status IN ('open','in_progress','waiting_customer','resolved','closed','cancelled')
        ),
        -- A resolved ticket must say when, or the reckoning has an open-ended
        -- outage it cannot bound.
        CONSTRAINT tickets_resolved_chk CHECK (status <> 'resolved' OR resolved_at IS NOT NULL),
        CONSTRAINT tickets_order_chk CHECK (resolved_at IS NULL OR resolved_at >= opened_at),
        CONSTRAINT tickets_paused_chk CHECK (paused_minutes >= 0)
      )
    `);
    await q.query(`CREATE UNIQUE INDEX tickets_tenant_number_uq ON tickets (tenant_id, number)`);
    await q.query(`CREATE INDEX tickets_tenant_status_idx ON tickets (tenant_id, status, severity)`);
    await q.query(`CREATE INDEX tickets_environment_idx ON tickets (environment_id)`);
    // Drives the breach scanner, which runs every minute: only rows still
    // awaiting a first response are ever candidates.
    await q.query(`
      CREATE INDEX tickets_pending_response_idx ON tickets (response_due_at)
        WHERE first_response_at IS NULL AND response_breached = false
    `);
    await q.query(`
      CREATE INDEX tickets_search_trgm_idx ON tickets USING gin (
        tenant_id, (coalesce(subject, '') || ' ' || coalesce(environment_code, '')) gin_trgm_ops
      )
    `);

    await q.query(`
      CREATE TABLE sla_periods (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL,
        environment_id    uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
        environment_code  varchar(40) NOT NULL,
        month             date NOT NULL,
        measured_minutes  int NOT NULL,
        downtime_minutes  int NOT NULL,
        achieved_bps      int NOT NULL,
        target_bps        int NOT NULL,
        breached          boolean NOT NULL DEFAULT false,
        credit_minor      bigint,
        credit_currency   char(3),
        reckoned_at       timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT sla_month_chk CHECK (date_part('day', month) = 1),
        CONSTRAINT sla_bps_chk CHECK (
          achieved_bps BETWEEN 0 AND 10000 AND target_bps BETWEEN 0 AND 10000
        ),
        CONSTRAINT sla_minutes_chk CHECK (
          measured_minutes >= 0 AND downtime_minutes >= 0 AND downtime_minutes <= measured_minutes
        ),
        -- A credit is meaningless without its currency, and vice versa.
        CONSTRAINT sla_credit_chk CHECK ((credit_minor IS NULL) = (credit_currency IS NULL)),
        -- No credit without a breach: this figure ends up on an invoice.
        CONSTRAINT sla_credit_requires_breach_chk CHECK (breached OR credit_minor IS NULL)
      )
    `);
    // One reckoning per environment per month, enforced by the database rather
    // than by the service remembering to check.
    await q.query(`
      CREATE UNIQUE INDEX sla_periods_unique ON sla_periods (tenant_id, environment_id, month)
    `);

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
    await q.query(`DROP TABLE IF EXISTS sla_periods`);
    await q.query(`DROP TABLE IF EXISTS tickets`);
    await q.query(`DROP TABLE IF EXISTS environments`);
  }
}
