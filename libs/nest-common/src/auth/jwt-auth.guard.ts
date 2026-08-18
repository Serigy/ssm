import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { setContextActor } from '../http/correlation.middleware.js';
import { tagZenUser } from '../security/zen.js';
import { CHECK_REVOCATION_KEY } from '../redis/decorators.js';
import { TokenDenylistService } from '../redis/token-denylist.service.js';
import { PUBLIC_KEY, type AuthenticatedUser } from './decorators.js';
import { JwtService } from './jwt.service.js';

/**
 * Verifies the bearer token on every request that is not explicitly @Public().
 *
 * Deliberately applied as a global guard: a new controller is protected by
 * default and must opt out in writing. The opposite arrangement — opting in —
 * is how endpoints end up unauthenticated by accident.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly log = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly denylist: TokenDenylistService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const claims = await this.jwt.verify(header.slice(7));

      // Signature and expiry are checked offline; revocation is not, so it
      // costs a Redis round trip and is therefore paid only where it matters:
      // every mutating request, plus routes that ask for it. See
      // TokenDenylistService.shouldCheck for the reasoning and the residual risk.
      const explicit = Boolean(
        this.reflector.getAllAndOverride<boolean>(CHECK_REVOCATION_KEY, [
          ctx.getHandler(),
          ctx.getClass(),
        ]),
      );
      if (TokenDenylistService.shouldCheck(req.method, explicit)) {
        if (await this.denylist.isRevoked(claims)) {
          throw new UnauthorizedException('Esta sessão foi revogada. Entre novamente.');
        }
      }

      const user: AuthenticatedUser = {
        id: claims.sub,
        tenantId: claims.tid,
        email: claims.email,
        name: claims.name,
        roles: claims.roles,
        permissions: new Set(claims.perms),
        claims,
      };
      (req as Request & { user: AuthenticatedUser }).user = user;

      setContextActor(user.id, user.tenantId);
      // Lets Zen rate-limit and block per principal rather than per source IP,
      // which is meaningless behind a shared Ingress.
      tagZenUser(user.id, user.email);
      return true;
    } catch (err) {
      // A revocation rejection carries its own message and must reach the
      // client intact; only verification failures collapse into the generic one.
      if (err instanceof UnauthorizedException) throw err;
      this.log.debug(`Token rejected: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
