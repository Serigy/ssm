import { z } from 'zod';
import { SSM_MODULES } from '../common/primitives.js';

/**
 * Permissions are `module:resource:action`. The gateway and every service
 * evaluate the same strings, so a permission added here is enforceable
 * everywhere without a code change in the guard.
 */
export const ACTIONS = ['read', 'create', 'update', 'delete', 'approve', 'export'] as const;
export type Action = (typeof ACTIONS)[number];

export const PERMISSIONS = [
  // financial
  'financial:invoice:read',
  'financial:invoice:create',
  'financial:invoice:update',
  'financial:invoice:delete',
  'financial:invoice:approve',
  'financial:report:export',
  // hr
  'hr:employee:read',
  'hr:employee:create',
  'hr:employee:update',
  'hr:employee:delete',
  'hr:payroll:read',
  'hr:payroll:approve',
  // legal
  'legal:contract:read',
  'legal:contract:create',
  'legal:contract:update',
  'legal:contract:delete',
  'legal:contract:approve',
  // operations
  'operations:environment:read',
  'operations:environment:create',
  'operations:environment:update',
  'operations:environment:delete',
  'operations:ticket:read',
  'operations:ticket:create',
  'operations:ticket:update',
  'operations:ticket:delete',
  'operations:sla:read',
  // Reckoning a month produces a credit on a customer's invoice. That is an
  // approval, not an update.
  'operations:sla:approve',
  // platform
  'platform:user:read',
  'platform:user:manage',
  'platform:audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Roles are named bundles of permissions. A user may hold several; the
 * effective permission set is the union. There is no deny rule — absence is denial.
 */
export const ROLES = {
  'platform:admin': PERMISSIONS,
  'financial:controller': PERMISSIONS.filter((p) => p.startsWith('financial:')),
  'financial:clerk': ['financial:invoice:read', 'financial:invoice:create'],
  'hr:manager': PERMISSIONS.filter((p) => p.startsWith('hr:')),
  'hr:viewer': ['hr:employee:read'],
  'legal:counsel': PERMISSIONS.filter((p) => p.startsWith('legal:')),
  'legal:viewer': ['legal:contract:read'],
  'operations:lead': PERMISSIONS.filter((p) => p.startsWith('operations:')),
  /**
   * The on-call engineer: opens, works and resolves tickets, sees the
   * inventory — but does not provision environments, does not renegotiate an
   * availability target, and does not sign off a month that becomes a credit.
   * Those are decisions with contractual and financial weight, taken awake.
   */
  'operations:oncall': [
    'operations:environment:read',
    'operations:ticket:read',
    'operations:ticket:create',
    'operations:ticket:update',
    'operations:sla:read',
  ],
  'operations:viewer': ['operations:environment:read', 'operations:ticket:read'],
  auditor: [
    'platform:audit:read',
    'financial:invoice:read',
    'legal:contract:read',
    'operations:sla:read',
  ],
} as const satisfies Record<string, readonly string[]>;

export type RoleName = keyof typeof ROLES;

export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) {
    const grants = ROLES[role as RoleName];
    if (grants) for (const p of grants) out.add(p as Permission);
  }
  return out;
}

/** Which modules a user can see in the shell's navigation. */
export function visibleModules(perms: Set<Permission>): string[] {
  return SSM_MODULES.filter((m) => [...perms].some((p) => p.startsWith(`${m}:`)));
}
