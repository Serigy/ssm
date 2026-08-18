/**
 * Permissions are `module:resource:action`. The gateway and every service
 * evaluate the same strings, so a permission added here is enforceable
 * everywhere without a code change in the guard.
 */
export declare const ACTIONS: readonly ["read", "create", "update", "delete", "approve", "export"];
export type Action = (typeof ACTIONS)[number];
export declare const PERMISSIONS: readonly ["financial:invoice:read", "financial:invoice:create", "financial:invoice:update", "financial:invoice:delete", "financial:invoice:approve", "financial:report:export", "hr:employee:read", "hr:employee:create", "hr:employee:update", "hr:employee:delete", "hr:payroll:read", "hr:payroll:approve", "legal:contract:read", "legal:contract:create", "legal:contract:update", "legal:contract:delete", "legal:contract:approve", "platform:user:read", "platform:user:manage", "platform:audit:read"];
export type Permission = (typeof PERMISSIONS)[number];
/**
 * Roles are named bundles of permissions. A user may hold several; the
 * effective permission set is the union. There is no deny rule — absence is denial.
 */
export declare const ROLES: {
    readonly 'platform:admin': readonly ["financial:invoice:read", "financial:invoice:create", "financial:invoice:update", "financial:invoice:delete", "financial:invoice:approve", "financial:report:export", "hr:employee:read", "hr:employee:create", "hr:employee:update", "hr:employee:delete", "hr:payroll:read", "hr:payroll:approve", "legal:contract:read", "legal:contract:create", "legal:contract:update", "legal:contract:delete", "legal:contract:approve", "platform:user:read", "platform:user:manage", "platform:audit:read"];
    readonly 'financial:controller': ("financial:invoice:read" | "financial:invoice:create" | "financial:invoice:update" | "financial:invoice:delete" | "financial:invoice:approve" | "financial:report:export" | "hr:employee:read" | "hr:employee:create" | "hr:employee:update" | "hr:employee:delete" | "hr:payroll:read" | "hr:payroll:approve" | "legal:contract:read" | "legal:contract:create" | "legal:contract:update" | "legal:contract:delete" | "legal:contract:approve" | "platform:user:read" | "platform:user:manage" | "platform:audit:read")[];
    readonly 'financial:clerk': readonly ["financial:invoice:read", "financial:invoice:create"];
    readonly 'hr:manager': ("financial:invoice:read" | "financial:invoice:create" | "financial:invoice:update" | "financial:invoice:delete" | "financial:invoice:approve" | "financial:report:export" | "hr:employee:read" | "hr:employee:create" | "hr:employee:update" | "hr:employee:delete" | "hr:payroll:read" | "hr:payroll:approve" | "legal:contract:read" | "legal:contract:create" | "legal:contract:update" | "legal:contract:delete" | "legal:contract:approve" | "platform:user:read" | "platform:user:manage" | "platform:audit:read")[];
    readonly 'hr:viewer': readonly ["hr:employee:read"];
    readonly 'legal:counsel': ("financial:invoice:read" | "financial:invoice:create" | "financial:invoice:update" | "financial:invoice:delete" | "financial:invoice:approve" | "financial:report:export" | "hr:employee:read" | "hr:employee:create" | "hr:employee:update" | "hr:employee:delete" | "hr:payroll:read" | "hr:payroll:approve" | "legal:contract:read" | "legal:contract:create" | "legal:contract:update" | "legal:contract:delete" | "legal:contract:approve" | "platform:user:read" | "platform:user:manage" | "platform:audit:read")[];
    readonly 'legal:viewer': readonly ["legal:contract:read"];
    readonly auditor: readonly ["platform:audit:read", "financial:invoice:read", "legal:contract:read"];
};
export type RoleName = keyof typeof ROLES;
export declare function permissionsFor(roles: readonly string[]): Set<Permission>;
/** Which modules a user can see in the shell's navigation. */
export declare function visibleModules(perms: Set<Permission>): string[];
//# sourceMappingURL=rbac.d.ts.map