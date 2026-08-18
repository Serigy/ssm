import { z } from 'zod';
export declare const userStatusSchema: z.ZodEnum<["active", "invited", "suspended", "disabled"]>;
export declare const userSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    email: z.ZodString;
    displayName: z.ZodString;
    status: z.ZodEnum<["active", "invited", "suspended", "disabled"]>;
    roles: z.ZodArray<z.ZodString, "many">;
    lastLoginAt: z.ZodNullable<z.ZodString>;
} & {
    createdAt: z.ZodString;
    createdBy: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
    updatedBy: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "active" | "invited" | "suspended" | "disabled";
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    id: string;
    tenantId: string;
    email: string;
    displayName: string;
    roles: string[];
    lastLoginAt: string | null;
}, {
    status: "active" | "invited" | "suspended" | "disabled";
    createdAt: string;
    createdBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    id: string;
    tenantId: string;
    email: string;
    displayName: string;
    roles: string[];
    lastLoginAt: string | null;
}>;
export type User = z.infer<typeof userSchema>;
export declare const loginRequestSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export declare const tokenPairSchema: z.ZodObject<{
    accessToken: z.ZodString;
    refreshToken: z.ZodString;
    tokenType: z.ZodLiteral<"Bearer">;
    expiresIn: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    accessToken: string;
    refreshToken: string;
    tokenType: "Bearer";
    expiresIn: number;
}, {
    accessToken: string;
    refreshToken: string;
    tokenType: "Bearer";
    expiresIn: number;
}>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
/** Claims carried by the RS256 access token. Verified by the gateway and each service. */
export declare const jwtClaimsSchema: z.ZodObject<{
    sub: z.ZodString;
    tid: z.ZodString;
    email: z.ZodString;
    name: z.ZodString;
    roles: z.ZodArray<z.ZodString, "many">;
    perms: z.ZodArray<z.ZodString, "many">;
    iss: z.ZodString;
    aud: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>;
    iat: z.ZodNumber;
    exp: z.ZodNumber;
    jti: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    roles: string[];
    sub: string;
    tid: string;
    name: string;
    perms: string[];
    iss: string;
    aud: string | string[];
    iat: number;
    exp: number;
    jti: string;
}, {
    email: string;
    roles: string[];
    sub: string;
    tid: string;
    name: string;
    perms: string[];
    iss: string;
    aud: string | string[];
    iat: number;
    exp: number;
    jti: string;
}>;
export type JwtClaims = z.infer<typeof jwtClaimsSchema>;
/** The shape the shell receives from GET /api/identity/me. */
export declare const sessionSchema: z.ZodObject<{
    user: z.ZodObject<Pick<{
        id: z.ZodString;
        tenantId: z.ZodString;
        email: z.ZodString;
        displayName: z.ZodString;
        status: z.ZodEnum<["active", "invited", "suspended", "disabled"]>;
        roles: z.ZodArray<z.ZodString, "many">;
        lastLoginAt: z.ZodNullable<z.ZodString>;
    } & {
        createdAt: z.ZodString;
        createdBy: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodString;
        updatedBy: z.ZodNullable<z.ZodString>;
    }, "id" | "tenantId" | "email" | "displayName" | "roles">, "strip", z.ZodTypeAny, {
        id: string;
        tenantId: string;
        email: string;
        displayName: string;
        roles: string[];
    }, {
        id: string;
        tenantId: string;
        email: string;
        displayName: string;
        roles: string[];
    }>;
    permissions: z.ZodArray<z.ZodString, "many">;
    modules: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    user: {
        id: string;
        tenantId: string;
        email: string;
        displayName: string;
        roles: string[];
    };
    permissions: string[];
    modules: string[];
}, {
    user: {
        id: string;
        tenantId: string;
        email: string;
        displayName: string;
        roles: string[];
    };
    permissions: string[];
    modules: string[];
}>;
export type Session = z.infer<typeof sessionSchema>;
//# sourceMappingURL=user.d.ts.map