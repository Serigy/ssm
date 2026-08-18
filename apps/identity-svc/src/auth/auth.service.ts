import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  permissionsFor,
  visibleModules,
  type LoginRequest,
  type Session,
  type TokenPair,
} from '@ssm/contracts';
import { JwtService, type AppConfig } from '@ssm/nest-common';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';
import { UserEntity } from '../users/user.entity.js';
import { RefreshTokenEntity } from './refresh-token.entity.js';

/**
 * Argon2id parameters. 64 MiB and 3 passes is the OWASP baseline: high enough
 * that a leaked hash table is expensive to attack, low enough that a login pod
 * with a 256 MiB limit can serve several concurrent logins.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly jwt: JwtService,
    private readonly cfg: AppConfig,
  ) {}

  async login(
    dto: LoginRequest,
    meta: { userAgent?: string; ip?: string },
  ): Promise<TokenPair> {
    const user = await this.db
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .where('lower(u.email) = lower(:email)', { email: dto.email })
      .getOne();

    // Hash even when the user does not exist, so the response time does not
    // reveal which addresses are registered.
    if (!user) {
      await argon2.hash(dto.password, ARGON2_OPTIONS).catch(() => undefined);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(
        `Conta bloqueada até ${user.lockedUntil.toISOString()}. ` +
          'Aguarde ou peça a um administrador para desbloquear.',
      );
    }

    const valid = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!valid) {
      await this.registerFailure(user);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    if (user.status !== 'active') {
      throw new ForbiddenException(
        `Esta conta está "${user.status}" e não pode entrar. Procure um administrador.`,
      );
    }

    await this.db.getRepository(UserEntity).update(user.id, {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });

    return this.issuePair(user, randomUUID(), meta);
  }

  /**
   * Rotates the refresh token. Presenting a token that has already been used
   * means it leaked, so the entire family — every token descending from that
   * login — is revoked at once.
   */
  async refresh(rawToken: string, meta: { userAgent?: string; ip?: string }): Promise<TokenPair> {
    const hash = sha256(rawToken);
    const repo = this.db.getRepository(RefreshTokenEntity);
    const stored = await repo.findOne({ where: { tokenHash: hash } });

    if (!stored) throw new UnauthorizedException('Sessão inválida. Entre novamente.');

    if (stored.usedAt || stored.revokedAt) {
      this.log.warn(
        `Reuso de refresh token detectado (família ${stored.familyId}, usuário ` +
          `${stored.userId}). Revogando a família inteira.`,
      );
      await repo.update({ familyId: stored.familyId }, { revokedAt: new Date() });
      throw new UnauthorizedException(
        'Esta sessão foi encerrada por segurança. Entre novamente.',
      );
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }

    const user = await this.db.getRepository(UserEntity).findOne({ where: { id: stored.userId } });
    if (!user || user.status !== 'active') {
      await repo.update({ familyId: stored.familyId }, { revokedAt: new Date() });
      throw new UnauthorizedException('Conta indisponível.');
    }

    await repo.update({ tokenHash: hash }, { usedAt: new Date() });
    return this.issuePair(user, stored.familyId, meta);
  }

  /** Revokes the whole family, so every device from that login is signed out. */
  async logout(rawToken: string): Promise<void> {
    const stored = await this.db
      .getRepository(RefreshTokenEntity)
      .findOne({ where: { tokenHash: sha256(rawToken) } });
    if (!stored) return;
    await this.db
      .getRepository(RefreshTokenEntity)
      .update({ familyId: stored.familyId }, { revokedAt: new Date() });
  }

  async session(userId: string): Promise<Session> {
    const user = await this.db.getRepository(UserEntity).findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Sessão inválida.');

    const perms = permissionsFor(user.roles);
    return {
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
      },
      permissions: [...perms],
      modules: visibleModules(perms),
    };
  }

  // --- internals -----------------------------------------------------------

  private async issuePair(
    user: UserEntity,
    familyId: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<TokenPair> {
    const perms = [...permissionsFor(user.roles)];

    // Permissions are baked into the token so every other service authorises
    // offline. The cost is that a role change takes effect at the next refresh.
    const accessToken = await this.jwt.sign({
      sub: user.id,
      tid: user.tenantId,
      email: user.email,
      name: user.displayName,
      roles: user.roles,
      perms,
    });

    // 256 bits from the CSPRNG. Stored only as a hash, so a database dump does
    // not hand over live sessions.
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.cfg.REFRESH_TOKEN_TTL_SECONDS * 1000);

    await this.db.getRepository(RefreshTokenEntity).insert({
      tokenHash: sha256(raw),
      userId: user.id,
      tenantId: user.tenantId,
      familyId,
      expiresAt,
      usedAt: null,
      revokedAt: null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ipAddress: meta.ip ?? null,
    });

    return {
      accessToken,
      refreshToken: raw,
      tokenType: 'Bearer',
      expiresIn: this.cfg.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  private async registerFailure(user: UserEntity): Promise<void> {
    const attempts = user.failedAttempts + 1;
    const lock =
      attempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
        : user.lockedUntil;

    await this.db
      .getRepository(UserEntity)
      .update(user.id, { failedAttempts: attempts, lockedUntil: lock });

    if (lock && attempts >= MAX_FAILED_ATTEMPTS) {
      this.log.warn(`Conta ${user.id} bloqueada após ${attempts} tentativas.`);
    }
  }

  /** Hash a password for seeding and for the change-password flow. */
  static hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time compare, for anywhere a secret is matched outside argon2. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
