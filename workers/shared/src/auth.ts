import { jwtClaimsSchema, type JwtClaims, type Permission } from '@ssm/contracts';
import type { MiddlewareHandler } from 'hono';
import { jwtVerify, importSPKI } from 'jose';
import type { BaseBindings } from './env.js';
import { HttpProblem } from './problem.js';

export interface Actor {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  roles: string[];
  permissions: Set<string>;
  claims: JwtClaims;
}

/**
 * A chave pública é importada uma vez por isolate e reaproveitada.
 *
 * Importar a chave é caro em CPU, e o Worker tem orçamento de CPU por
 * requisição. Um isolate atende muitas requisições, então guardar aqui fora do
 * handler transforma um custo por requisição em um custo por isolate.
 */
let cachedKey: CryptoKey | undefined;
let cachedPem: string | undefined;

async function publicKey(pem: string): Promise<CryptoKey> {
  if (cachedKey && cachedPem === pem) return cachedKey;
  cachedKey = (await importSPKI(pem, 'RS256')) as CryptoKey;
  cachedPem = pem;
  return cachedKey;
}

/**
 * Verificação offline, como no NestJS: a assinatura é conferida com a chave
 * pública, sem chamada de rede. O identity Worker pode estar fora do ar e as
 * sessões já emitidas continuam válidas.
 */
export function requireAuth(): MiddlewareHandler<{ Bindings: BaseBindings; Variables: { actor: Actor } }> {
  return async (c, next) => {
    const header = c.req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw HttpProblem.unauthorized();

    let claims: JwtClaims;
    try {
      const { payload } = await jwtVerify(header.slice(7), await publicKey(c.env.JWT_PUBLIC_KEY), {
        issuer: c.env.JWT_ISSUER,
        audience: c.env.JWT_AUDIENCE,
        algorithms: ['RS256'],
        clockTolerance: 5,
      });
      claims = jwtClaimsSchema.parse(payload);
    } catch {
      throw HttpProblem.unauthorized('Invalid or expired token');
    }

    // Revogação: o KV é o lugar certo para isto e só para isto. A propagação
    // de cerca de um minuto é aceitável para revogação; não seria para um
    // contador de limite nem para idempotência — esses ficam no Durable Object.
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const [tokenHit, watermark] = await Promise.all([
        c.env.KV.get(`revoked:jti:${claims.jti}`),
        c.env.KV.get(`revoked:user:${claims.sub}`),
      ]);
      if (tokenHit || (watermark && claims.iat <= Number(watermark))) {
        throw HttpProblem.unauthorized('Esta sessão foi revogada. Entre novamente.');
      }
    }

    c.set('actor', {
      id: claims.sub,
      tenantId: claims.tid,
      email: claims.email,
      name: claims.name,
      roles: claims.roles,
      permissions: new Set(claims.perms),
      claims,
    });
    await next();
  };
}

/** Exige todas as permissões listadas. Mesma semântica do @RequirePermissions. */
export function requirePermissions(
  ...perms: Permission[]
): MiddlewareHandler<{ Bindings: BaseBindings; Variables: { actor: Actor } }> {
  return async (c, next) => {
    const actor = c.get('actor');
    const missing = perms.filter((p) => !actor.permissions.has(p));
    if (missing.length) {
      throw HttpProblem.forbidden(`Missing permission(s): ${missing.join(', ')}`);
    }
    await next();
  };
}
