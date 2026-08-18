import { SecretsService, loadConfig } from '@ssm/nest-common';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { RefreshTokenEntity } from '../auth/refresh-token.entity.js';
import { UserEntity } from '../users/user.entity.js';

export function buildTypeOrmOptions(): DataSourceOptions {
  const cfg = loadConfig({ SERVICE_NAME: 'identity-svc' });
  const secrets = new SecretsService(cfg.SSM_SECRETS_DIR);

  return {
    type: 'postgres',
    host: cfg.POSTGRES_HOST,
    port: cfg.POSTGRES_PORT,
    username: cfg.POSTGRES_USER,
    password: secrets.require('postgres_password'),
    database: cfg.POSTGRES_DB,
    ssl: cfg.POSTGRES_SSL ? { rejectUnauthorized: false } : false,
    entities: [UserEntity, RefreshTokenEntity],
    // Resolved from the compiled file's own location. A cwd-relative glob
    // breaks the moment this runs from the TypeORM CLI, a Helm Job and
    // `make migrate` — which all have different working directories.
    migrations: [join(__dirname, 'migrations', '*.js')],
    synchronize: false,
    migrationsRun: false,
    logging: cfg.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    poolSize: 10,
    extra: { statement_timeout: 10_000 },
  };
}

export const AppDataSource = new DataSource(buildTypeOrmOptions());
