import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitIdentity1747000002000 implements MigrationInterface {
  name = 'InitIdentity1747000002000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await q.query(`
      CREATE TABLE users (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        uuid NOT NULL,
        email            varchar(320) NOT NULL,
        password_hash    text NOT NULL,
        display_name     varchar(200) NOT NULL,
        status           varchar(16) NOT NULL DEFAULT 'invited',
        roles            text[] NOT NULL DEFAULT '{}',
        last_login_at    timestamptz,
        failed_attempts  int NOT NULL DEFAULT 0,
        locked_until     timestamptz,
        created_at       timestamptz NOT NULL DEFAULT now(),
        created_by       uuid,
        updated_at       timestamptz NOT NULL DEFAULT now(),
        updated_by       uuid,

        CONSTRAINT users_status_chk CHECK (status IN ('active','invited','suspended','disabled'))
      )
    `);
    // Case-insensitive uniqueness: "Ana@x.com" and "ana@x.com" are one person.
    await q.query(`CREATE UNIQUE INDEX users_tenant_email_uq ON users (tenant_id, lower(email))`);

    await q.query(`
      CREATE TABLE refresh_tokens (
        token_hash   char(64) PRIMARY KEY,
        user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id    uuid NOT NULL,
        family_id    uuid NOT NULL,
        expires_at   timestamptz NOT NULL,
        used_at      timestamptz,
        revoked_at   timestamptz,
        user_agent   text,
        ip_address   inet,
        created_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id)`);
    await q.query(`CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id)`);
    // Lets the cleanup job delete expired rows without scanning the table.
    await q.query(`CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS refresh_tokens`);
    await q.query(`DROP TABLE IF EXISTS users`);
  }
}
