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
      this.log.debug(`Token rejected: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
