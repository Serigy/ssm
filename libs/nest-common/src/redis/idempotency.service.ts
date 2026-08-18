import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from './redis.service.js';

export interface IdempotentResult {
  status: number;
  body: unknown;
  /** Hash of method + path + payload, so key reuse with a different body is caught. */
  fingerprint: string;
}

export type IdempotencyLookup =
  | { state: 'fresh' }
  | { state: 'replay'; result: IdempotentResult }
  | { state: 'in-flight' }
  | { state: 'conflict'; storedFingerprint: string };

/**
 * Records the outcome of a mutating request against a client-supplied key, so
 * that a retry replays the original answer instead of doing the work twice.
 *
 * The problem is not hypothetical. A client POSTs a payment, the response is
 * lost to a timeout, the client retries — and the invoice is now paid twice.
 * The client cannot tell a lost response from a lost request, so it must be
 * safe to retry, and only the server can make it so.
 *
 * `Idempotency-Key` was already in the CORS allow-list from the first commit
 * and nothing read it, which is worse than not offering it: a client following
 * the advertised contract would have believed itself protected.
 */
@Injectable()
export class IdempotencyService {
  private static readonly PREFIX = 'ssm:idem:';
  /** A day is longer than any sane retry window and short enough to bound the keyspace. */
  private static readonly TTL_SECONDS = 24 * 60 * 60;
  /** How long a request may hold the key before another attempt may take it. */
  private static readonly LOCK_SECONDS = 60;

  constructor(private readonly redis: RedisService) {}

  static fingerprint(method: string, path: string, body: unknown): string {
    return createHash('sha256')
      .update(`${method}\n${path}\n${JSON.stringify(body ?? null)}`)
      .digest('hex');
  }

  /**
   * Claims the key for this request, or reports what is already there.
   *
   * The claim is a `SET NX` — atomic, so two concurrent retries cannot both
   * decide they are the first. The loser gets `in-flight` and a 409 rather than
   * a duplicate write.
   */
  async claim(tenantId: string, key: string, fingerprint: string): Promise<IdempotencyLookup> {
    const redisKey = this.key(tenantId, key);

    return this.redis.run<IdempotencyLookup>(
      'reservar chave de idempotência',
      async (c) => {
        const claimed = await c.set(
          redisKey,
          JSON.stringify({ state: 'in-flight', fingerprint }),
          'EX',
          IdempotencyService.LOCK_SECONDS,
          'NX',
        );
        if (claimed === 'OK') return { state: 'fresh' };

        const raw = await c.get(redisKey);
        if (!raw) return { state: 'fresh' };

        const stored = JSON.parse(raw) as
          | { state: 'in-flight'; fingerprint: string }
          | ({ state: 'done' } & IdempotentResult);

        // Same key, different payload. Replaying the stored response would
        // answer a question the client did not ask, so refuse instead.
        if (stored.fingerprint !== fingerprint) {
          return { state: 'conflict', storedFingerprint: stored.fingerprint };
        }

        if (stored.state === 'in-flight') return { state: 'in-flight' };
        return { state: 'replay', result: stored };
      },
      // Redis down: treat every request as new. Deduplication stops; nothing
      // else changes. See the fail-open note in RedisService.
      { state: 'fresh' },
    );
  }

  /** Stores the outcome so the next retry with this key replays it. */
  async complete(
    tenantId: string,
    key: string,
    result: IdempotentResult,
  ): Promise<void> {
    await this.redis.run(
      'gravar resultado idempotente',
      async (c) =>
        c.set(
          this.key(tenantId, key),
          JSON.stringify({ state: 'done', ...result }),
          'EX',
          IdempotencyService.TTL_SECONDS,
        ),
      null,
    );
  }

  /**
   * Releases the key after a failure.
   *
   * A failed request must not be replayed as if it had succeeded, and it must
   * not hold the key hostage for the lock window either — the client is
   * entitled to retry a 500 immediately.
   */
  async release(tenantId: string, key: string): Promise<void> {
    await this.redis.run('liberar chave de idempotência', async (c) => c.del(this.key(tenantId, key)), null);
  }

  /** Tenant-scoped, so one client's key cannot collide with another's. */
  private key(tenantId: string, key: string): string {
    return `${IdempotencyService.PREFIX}${tenantId}:${key}`;
  }
}
