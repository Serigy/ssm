import { SecretsService, loadConfig } from '@ssm/nest-common';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { InvoiceEntity } from '../invoices/invoice.entity.js';
import { InvoiceLineEntity } from '../invoices/invoice-line.entity.js';
import { OutboxEntity } from './outbox.entity.js';

export function buildTypeOrmOptions(): DataSourceOptions {
  const cfg = loadConfig({ SERVICE_NAME: 'financial-svc' });
  const secrets = new SecretsService(cfg.SSM_SECRETS_DIR);

  return {
    type: 'postgres',
    host: cfg.POSTGRES_HOST,
    port: cfg.POSTGRES_PORT,
    username: cfg.POSTGRES_USER,
    password: secrets.require('postgres_password'),
    database: cfg.POSTGRES_DB,
    ssl: cfg.POSTGRES_SSL ? { rejectUnauthorized: false } : false,
    entities: [InvoiceEntity, InvoiceLineEntity, OutboxEntity],
    // Resolved from the compiled file's own location. A cwd-relative glob
    // breaks the moment this runs from the TypeORM CLI, a Helm Job and
    // `make migrate` — which all have different working directories.
    migrations: [join(__dirname, 'migrations', '*.js')],
    // Never true. Schema changes go through a reviewed migration, in every
    // environment, so that what runs in production is what was tested.
    synchronize: false,
    migrationsRun: false,
    logging: cfg.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    poolSize: 10,
    extra: {
      // A query that hangs holds a connection; better to fail it and let the
      // client retry than to exhaust the pool.
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 30_000,
    },
  };
}

/** Used by the TypeORM CLI for migrations, and by the readiness probe. */
export const AppDataSource = new DataSource(buildTypeOrmOptions());
