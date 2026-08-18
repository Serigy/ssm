import { Injectable, Logger } from '@nestjs/common';
import type { JwtClaims } from '@ssm/contracts';
import { RedisService } from './redis.service.js';

/**
 * Early revocation of access tokens.
 *
 * ADR 0002 made authorisation offline: every service verifies the RS256
 * signature locally and reads permissions straight from the token, with no
 * round trip. That is what lets identity-svc fall over without taking the
 * platform with it — and the price is that a revoked token stays usable until
 * it expires, up to 15 minutes.
 *
 * This closes that window without giving up offline authorisation, because it
 * is consulted **selectively**, not on every request. See `shouldCheck`.
 *
 * Two kinds of revocation, because they answer different questions:
 *
 *   revokeToken(jti)      — this one token is burned. Logout; a token you
 *                           believe leaked.
 *   revokeUserBefore(sub) — every token issued to this user before now is
 *                           burned. Role changed, account suspended, person
 *                           left. You cannot enumerate the jtis, and you should
 *                           not have to.
 */
@Injectable()
export class TokenDenylistService {
  private readonly log = new Logger(TokenDenylistService.name);

  private static readonly TOKEN_PREFIX = 'ssm:revoked:jti:';
  private static readonly USER_PREFIX = 'ssm:revoked:user:';

  constructor(private readonly redis: RedisService) {}

  /**
   * Burns one token until it would have expired anyway.
   *
   * The TTL is the token's own expiry: past that the signature check rejects it
   * regardless, so keeping the entry longer would grow the keyspace without
   * buying anything.
   */
  async revokeToken(jti: string, expiresAtEpochSeconds: number): Promise<void> {
    const ttl = Math.max(1, expiresAtEpochSeconds - Math.floor(Date.now() / 1000));
    await this.redis.run(
      'revogar token',
      async (c) => c.set(`${TokenDenylistService.TOKEN_PREFIX}${jti}`, '1', 'EX', ttl),
      null,
    );
  }

  /**
   * Burns every token issued to a user before this moment.
   *
   * Stores a watermark rather than a list: any token whose `iat` predates it is
   * rejected. One key per user instead of one per token, and it works for
   * tokens that were issued before the revocation was even contemplated.
   *
   * `maxTokenTtlSeconds` bounds how long the watermark must survive — after the
   * longest-lived token that could predate it has expired, the entry is inert.
   */
  async revokeUserBefore(userId: string, maxTokenTtlSeconds: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.redis.run(
      'revogar tokens do usuário',
      async (c) =>
        c.set(
          `${TokenDenylistService.USER_PREFIX}${userId}`,
          String(now),
          'EX',
          maxTokenTtlSeconds + 60,
        ),
      null,
    );
    this.log.log(`Tokens de ${userId} emitidos antes de ${now} foram revogados.`);
  }

  /**
   * True when this token must be refused.
   *
   * Fails open: an unreachable Redis returns false, so the token keeps whatever
   * validity its signature and expiry already grant. That is the same exposure
   * the system had before this service existed — bounded by the 15-minute TTL —
   * whereas failing closed would sign everyone out during a Redis blip.
   */
  async isRevoked(claims: JwtClaims): Promise<boolean> {
    if (!this.redis.enabled) return false;

    return this.redis.run(
      'consultar revogação',
      async (c) => {
        const [tokenHit, watermark] = await c.mget(
          `${TokenDenylistService.TOKEN_PREFIX}${claims.jti}`,
          `${TokenDenylistService.USER_PREFIX}${claims.sub}`,
        );

        if (tokenHit) return true;
        // Issued at or before the watermark means the token predates the
        // revocation. `<=` rather than `<` so a token minted in the same second
        // as the revocation is also caught.
        if (watermark && claims.iat <= Number(watermark)) return true;
        return false;
      },
      false,
    );
  }

  /**
   * Which requests pay for the lookup.
   *
   * Every mutating request, plus any route that opts in. Reads are left alone
   * on purpose: they are the bulk of the traffic, and putting a network hop in
   * front of every list endpoint would undo the reason authorisation is offline
   * in the first place.
   *
   * The residual risk is stated plainly: a revoked token can still *read* for up
   * to the remaining TTL. It cannot issue an invoice, offboard a person or
   * activate a contract.
   */
  static shouldCheck(method: string, explicitlyRequested: boolean): boolean {
    if (explicitlyRequested) return true;
    return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  }
}
