import { z } from 'zod';

/**
 * Non-secret configuration comes from the environment; secrets come from
 * files (see SecretsService). Keeping the two apart is deliberate: env vars
 * are visible in `docker inspect` and crash dumps, so nothing sensitive rides there.
 */
export const appConfigSchema = z.object({
  SERVICE_NAME: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Where SecretsService looks. Containers mount the Secret volume here. */
  SSM_SECRETS_DIR: z.string().default('/run/secrets'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),

  /** Comma-separated list of allowed browser origins. Never "*" outside dev. */
  CORS_ORIGINS: z.string().default('http://localhost:4200'),

  POSTGRES_HOST: z.string().default('postgres'),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_USER: z.string().default('ssm'),
  POSTGRES_DB: z.string().default('ssm'),
  POSTGRES_SSL: z.coerce.boolean().default(false),

  MONGO_HOST: z.string().default('mongo'),
  MONGO_PORT: z.coerce.number().int().default(27017),
  MONGO_USER: z.string().default('ssm'),
  MONGO_DB: z.string().default('ssm'),

  /**
   * Redis holds coordination state only — rate-limit counters, idempotency
   * keys, the token denylist. Nothing whose source of truth lives elsewhere;
   * see docs/adr/0010-cache-e-busca.md.
   */
  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.coerce.number().int().default(6379),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
  /**
   * Turning this off makes every Redis-backed control degrade to its
   * single-process behaviour. Useful for a developer running one service by
   * hand; never correct in a cluster, where it silently restores the
   * per-replica rate-limit bug this exists to fix.
   */
  REDIS_ENABLED: z.coerce.boolean().default(true),

  RABBITMQ_HOST: z.string().default('rabbitmq'),
  RABBITMQ_PORT: z.coerce.number().int().default(5672),
  RABBITMQ_USER: z.string().default('ssm'),
  RABBITMQ_VHOST: z.string().default('/'),

  /** Cloudflare R2. Falls back to a MinIO endpoint locally. */
  R2_ENDPOINT: z.string().default(''),
  R2_BUCKET: z.string().default('ssm-documents'),
  R2_REGION: z.string().default('auto'),
  R2_PUBLIC_BASE_URL: z.string().default(''),

  JWT_ISSUER: z.string().default('https://identity.ssm.local'),
  JWT_AUDIENCE: z.string().default('ssm'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().default(60 * 60 * 24 * 14),

  /** Aikido Zen in-app firewall. Set to false only for local debugging. */
  ZEN_ENABLED: z.coerce.boolean().default(true),
  /** Blocking mode. When false Zen only reports, which is the safe first rollout step. */
  ZEN_BLOCKING: z.coerce.boolean().default(false),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(''),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Parses process.env once at boot. Throws with every problem listed rather
 * than the first, so a misconfigured deployment is fixed in one pass.
 */
export function loadConfig(overrides: Partial<Record<string, string>> = {}): AppConfig {
  const parsed = appConfigSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const CONFIG = Symbol('SSM_APP_CONFIG');

export function isProd(cfg: AppConfig): boolean {
  return cfg.NODE_ENV === 'production' || cfg.NODE_ENV === 'staging';
}
