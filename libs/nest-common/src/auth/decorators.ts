import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { JwtClaims, Permission } from '@ssm/contracts';

export const PUBLIC_KEY = 'ssm:public';
export const PERMISSIONS_KEY = 'ssm:permissions';

/** Marks a route as reachable without a token. Use sparingly and audit it. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Requires every listed permission (AND). Two decorators are not supported —
 * pass all of them in one call so the requirement is visible in one place.
 */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, perms);

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  roles: string[];
  permissions: Set<string>;
  claims: JwtClaims;
}

/** Injects the verified principal. Never trust anything else on the request. */
export const CurrentUser = createParamDecorator((data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
  return data && user ? user[data] : user;
});

/**
 * Injects the tenant id. Every repository query must be scoped by it — this is
 * the primary defence against cross-tenant data exposure, and it comes from the
 * signed token, never from a header or a query parameter.
 */
export const TenantId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const user = ctx.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
  if (!user) throw new Error('TenantId used on a route without JwtAuthGuard');
  return user.tenantId;
});
