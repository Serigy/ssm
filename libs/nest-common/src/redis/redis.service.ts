import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';
import type { AppConfig } from '../config/app-config.js';
import { SecretsService } from '../secrets/secrets.service.js';

/**
 * Redis, used strictly for coordination state — rate-limit counters,
 * idempotency records, the token denylist. Nothing here duplicates a truth that
 * lives in Postgres or Mongo; see docs/adr/0010-cache-e-busca.md.
 *
 * The contract every caller depends on: **this service never throws and never
 * blocks a request.** Redis is a control plane for correctness, not a
 * dependency of availability. When it is unreachable, each control degrades to
 * the behaviour it had before Redis existed:
 *
 *   - rate limiting counts per replica again;
 *   - idempotency stops deduplicating;
 *   - the denylist stops revoking early, so a token stays valid until its TTL.
 *
 * That is failing *open*, deliberately. Failing closed would mean a Redis blip
 * takes the whole platform down — trading a bounded security window for a
 * total outage, which is the worse of the two. The compensating control is
 * noise: every degradation logs at error level, and `isHealthy()` feeds the
 * readiness probe, so it cannot be quiet.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(RedisService.name);
  private client?: Redis;
  private connected = false;

  /** Rate-limits the "Redis is down" log so an outage cannot flood the sink. */
  private lastDegradationLog = 0;
  private readonly degradationLogIntervalMs = 30_000;

  constructor(
    private readonly cfg: AppConfig,
    private readonly secrets: SecretsService,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.REDIS_ENABLED) {
      this.log.warn(
        'REDIS_ENABLED=false — rate limiting counts per replica, idempotency ' +
          'does not deduplicate and token revocation waits for the TTL. Never ' +
          'correct with more than one replica.',
      );
      return;
    }

    const options: RedisOptions = {
      host: this.cfg.REDIS_HOST,
      port: this.cfg.REDIS_PORT,
      db: this.cfg.REDIS_DB,
      password: this.secrets.get('redis_password'),
      // A request must never wait on a sick Redis. Two seconds is already
      // longer than any of these operations should take.
      connectTimeout: 2_000,
      commandTimeout: 1_000,
      // Do not queue commands while disconnected: a queued command resolves
      // after the caller has given up, and the queue grows without bound during
      // an outage.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
      // Keeps the client usable through a failover rather than erroring out.
      reconnectOnError: (err) => err.message.includes('READONLY'),
    };

    this.client = new Redis(options);

    this.client.on('ready', () => {
      this.connected = true;
      this.log.log(`Conectado ao Redis em ${this.cfg.REDIS_HOST}:${this.cfg.REDIS_PORT}`);
    });
    this.client.on('end', () => {
      this.connected = false;
    });
    this.client.on('error', (err: Error) => {
      this.connected = false;
      this.degraded('conexão', err);
    });

    void this.client.connect().catch((err: Error) => this.degraded('conexão inicial', err));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  isHealthy(): boolean {
    // Disabled counts as healthy: the operator asked for it, and readiness
    // should report the deployment's intent, not second-guess it.
    return !this.cfg.REDIS_ENABLED || this.connected;
  }

  get enabled(): boolean {
    return this.cfg.REDIS_ENABLED;
  }

  /**
   * Runs a Redis operation, or returns `fallback` if Redis cannot serve it.
   *
   * Every caller goes through here. That is what makes the fail-open promise a
   * property of the module rather than something each call site remembers.
   */
  async run<T>(label: string, op: (client: Redis) => Promise<T>, fallback: T): Promise<T> {
    if (!this.client || !this.connected) {
      this.degraded(label);
      return fallback;
    }
    try {
      return await op(this.client);
    } catch (err) {
      this.degraded(label, err as Error);
      return fallback;
    }
  }

  /** Direct access, for the throttler storage which needs a script cache. */
  get raw(): Redis | undefined {
    return this.connected ? this.client : undefined;
  }

  private degraded(label: string, err?: Error): void {
    const now = Date.now();
    if (now - this.lastDegradationLog < this.degradationLogIntervalMs) return;
    this.lastDegradationLog = now;
    this.log.error(
      `Redis indisponível (${label})${err ? `: ${err.message}` : ''}. ` +
        'Os controles seguem em modo degradado: limite de requisições por réplica, ' +
        'idempotência sem deduplicação e revogação de token aguardando o TTL.',
    );
  }
}
