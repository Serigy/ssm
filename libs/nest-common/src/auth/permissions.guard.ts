import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@ssm/contracts';
import { PERMISSIONS_KEY, type AuthenticatedUser } from './decorators.js';

/**
 * Enforces @RequirePermissions. Runs after JwtAuthGuard, so `req.user` is
 * already the verified principal.
 *
 * Permissions come from the token, which identity-svc computed from the user's
 * roles at login. That means a role change takes effect at the next token
 * refresh (<= 15 minutes) rather than instantly — an accepted trade for keeping
 * authorisation offline and off the hot path. Revocation that must be immediate
 * goes through the token denylist in identity-svc instead.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Not authenticated');

    const missing = required.filter((p) => !user.permissions.has(p));
    if (missing.length) {
      // Naming the missing permission is safe — it is a capability name, not data —
      // and it turns a support ticket into a one-line answer.
      throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}`);
    }
    return true;
  }
}
