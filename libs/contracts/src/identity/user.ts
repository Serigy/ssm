import { z } from 'zod';
import { auditSchema, isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

export const userStatusSchema = z.enum(['active', 'invited', 'suspended', 'disabled']);

export const userSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    email: z.string().email(),
    displayName: z.string().min(1).max(200),
    status: userStatusSchema,
    roles: z.array(z.string()),
    lastLoginAt: isoDateTimeSchema.nullable(),
  })
  .merge(auditSchema);
export type User = z.infer<typeof userSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

/** Claims carried by the RS256 access token. Verified by the gateway and each service. */
export const jwtClaimsSchema = z.object({
  sub: uuidSchema,
  tid: uuidSchema,
  email: z.string().email(),
  name: z.string(),
  roles: z.array(z.string()),
  perms: z.array(z.string()),
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  iat: z.number(),
  exp: z.number(),
  jti: z.string(),
});
export type JwtClaims = z.infer<typeof jwtClaimsSchema>;

/** The shape the shell receives from GET /api/identity/me. */
export const sessionSchema = z.object({
  user: userSchema.pick({ id: true, tenantId: true, email: true, displayName: true, roles: true }),
  permissions: z.array(z.string()),
  modules: z.array(z.string()),
});
export type Session = z.infer<typeof sessionSchema>;
