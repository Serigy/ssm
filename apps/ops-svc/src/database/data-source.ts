import { SecretsService, loadConfig } from '@ssm/nest-common';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { EnvironmentEntity } from '../environments/environment.entity.js';
import { TicketEntity } from '../tickets/ticket.entity.js';
import { SlaPeriodEntity } from '../sla/sla-period.entity.js';
import { OutboxEntity } from './outbox.entity.js';

export function buildTypeOrmOptions(): DataSourceOptions {
  const cfg = loadConfig({ SERVICE_NAME: 'ops-svc' });
  const secrets = new SecretsService(cfg.SSM_SECRETS_DIR);

  return {
    type: 'postgres',
    host: cfg.POSTGRES_HOST,
    port: cfg.POSTGRES_PORT,
    username: cfg.POSTGRES_USER,
    password: secrets.require('postgres_password'),
    database: cfg.POSTGRES_DB,
    ssl: cfg.POSTGRES_SSL ? { rejectUnauthorized: false } : false,
    entities: [EnvironmentEntity, TicketEntity, SlaPeriodEntity, OutboxEntity],
    migrations: [join(__dirname, 'migrations', '*.js')],
    synchronize: false,
    migrationsRun: false,
    logging: cfg.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    poolSize: 10,
    extra: { statement_timeout: 15_000, idle_in_transaction_session_timeout: 30_000 },
  };
}

export const AppDataSource = new DataSource(buildTypeOrmOptions());
