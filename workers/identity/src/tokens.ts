import { permissionsFor, type TokenPair } from '@ssm/contracts';
import type { BaseBindings } from '@ssm/worker-common';
import { SignJWT, importPKCS8 } from 'jose';

/**
 * Emissão de tokens.
 *
 * O par continua o mesmo do serviço em contêiner: access token RS256 de vida
 * curta com as permissões embutidas, e refresh token opaco de 256 bits guardado
 * só como hash. Nada disso muda por estar num Worker — o que muda é onde a
 * chave privada mora (`wrangler secret`) e que a importação dela é guardada por
 * isolate, porque importar uma chave é caro e o Worker paga CPU por requisição.
 */
let cachedKey: CryptoKey | undefined;
let cachedPem: string | undefined;

async function privateKey(pem: string): Promise<CryptoKey> {
  if (cachedKey && cachedPem === pem) return cachedKey;
  cachedKey = (await importPKCS8(pem, 'RS256')) as CryptoKey;
  cachedPem = pem;
  return cachedKey;
}

export interface TokenUser {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  roles: string[];
}

export async function signAccessToken(env: BaseBindings, user: TokenUser): Promise<string> {
  if (!env.JWT_PRIVATE_KEY) {
    throw new Error('JWT_PRIVATE_KEY ausente: só o Worker de identidade recebe a metade privada.');
  }
  const ttl = Number(env.ACCESS_TOKEN_TTL_SECONDS);

  return new SignJWT({
    tid: user.tenantId,
    email: user.email,
    name: user.displayName,
    roles: user.roles,
    // As permissões vão no token para que os outros Workers autorizem sem
    // consultar ninguém. O preço é que mudança de papel só vale no próximo
    // refresh — e é por isso que trocar papel dispara revogação.
    perms: [...permissionsFor(user.roles)],
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .setJti(crypto.randomUUID())
    .sign(await privateKey(env.JWT_PRIVATE_KEY));
}

/** 256 bits do gerador criptográfico. Guardado apenas como hash. */
export function mintRefreshToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function pairResponse(accessToken: string, ttlSeconds: number): Omit<TokenPair, 'refreshToken'> {
  return { accessToken, tokenType: 'Bearer', expiresIn: ttlSeconds };
}
