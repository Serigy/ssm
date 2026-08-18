import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import { RedisService } from './redis.service.js';

/**
 * Rate-limit counters shared across replicas.
 *
 * Without this, @nestjs/throttler counts in the process's own memory. The
 * gateway runs three replicas, so the configured limit was multiplied by three
 * and which pod answered a given request was arbitrary — the control described
 * in docs/security/modelo-de-ameacas.md did not do what it said.
 *
 * The increment has to be atomic: read-then-write from three replicas races,
 * and the race always resolves in the attacker's favour. Hence the Lua script,
 * which Redis runs as a single operation.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly log = new Logger(RedisThrottlerStorage.name);

  /**
   * Returns [hits, ttlMs, blocked, blockTtlMs].
   *
   * The block key is separate from the counter so that a client already blocked
   * keeps its penalty even after the counting window rolls over — otherwise the
   * block expires early and the limit is softer than configured.
   */
  private static readonly SCRIPT = `
    local counterKey = KEYS[1]
    local blockKey   = KEYS[2]
    local ttlMs      = tonumber(ARGV[1])
    local limit      = tonumber(ARGV[2])
    local blockMs    = tonumber(ARGV[3])

    local blockTtl = redis.call('PTTL', blockKey)
    if blockTtl > 0 then
      local hits = tonumber(redis.call('GET', counterKey) or limit)
      return { hits, blockTtl, 1, blockTtl }
    end

    local hits = redis.call('INCR', counterKey)
    if hits == 1 then
      redis.call('PEXPIRE', counterKey, ttlMs)
    end
    local ttl = redis.call('PTTL', counterKey)

    if hits > limit and blockMs > 0 then
      redis.call('SET', blockKey, 1, 'PX', blockMs)
      return { hits, ttl, 1, blockMs }
    end

    return { hits, ttl, 0, 0 }
  `;

  /** In-memory fallback, used only while Redis is unreachable. */
  private readonly local = new Map<string, { hits: number; expiresAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const counterKey = `ssm:rl:${throttlerName}:${key}`;
    const blockKey = `ssm:rl:blocked:${throttlerName}:${key}`;

    const fallback = () => this.incrementLocally(counterKey, ttl, limit);

    const client = this.redis.raw;
    if (!client) return fallback();

    try {
      const result = (await client.eval(
        RedisThrottlerStorage.SCRIPT,
        2,
        counterKey,
        blockKey,
        String(ttl),
        String(limit),
        String(blockDuration),
      )) as [number, number, number, number];

      const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = result;
      return {
        totalHits,
        timeToExpire: Math.max(0, Math.ceil(timeToExpire / 1000)),
        isBlocked: isBlocked === 1,
        timeToBlockExpire: Math.max(0, Math.ceil(timeToBlockExpire / 1000)),
      };
    } catch (err) {
      // Degrading to per-process counting is worse than the shared counter but
      // far better than rejecting traffic because Redis hiccuped.
      this.log.error(
        `Contagem de limite via Redis falhou (${(err as Error).message}). ` +
          'Voltando a contar por réplica até o Redis responder.',
      );
      return fallback();
    }
  }

  private incrementLocally(key: string, ttl: number, limit: number): ThrottlerStorageRecord {
    const now = Date.now();
    const entry = this.local.get(key);

    if (!entry || entry.expiresAt <= now) {
      this.local.set(key, { hits: 1, expiresAt: now + ttl });
      // Opportunistic sweep — this map only ever holds keys seen during an
      // outage, and nothing else prunes it.
      if (this.local.size > 10_000) {
        for (const [k, v] of this.local) if (v.expiresAt <= now) this.local.delete(k);
      }
      return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }

    entry.hits += 1;
    return {
      totalHits: entry.hits,
      timeToExpire: Math.ceil((entry.expiresAt - now) / 1000),
      isBlocked: entry.hits > limit,
      timeToBlockExpire: 0,
    };
  }
}
