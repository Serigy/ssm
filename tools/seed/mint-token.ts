/**
 * Prints a development access token, signed with the local private key.
 *
 * Three uses: driving a remote in standalone mode (`VITE_DEV_TOKEN`), curling a
 * service directly without the login flow, and — with `--tenant` — proving that
 * tenant isolation actually holds:
 *
 *   TOKEN=$(make -s token)
 *   OTHER=$(pnpm -s tsx tools/seed/mint-token.ts --tenant 99999999-9999-4999-8999-999999999999)
 *   curl -H "Authorization: Bearer $OTHER" localhost:3002/api/financial/v1/invoices/<id>
 *   # must be 404 — same 404 as "does not exist", never a 403
 *
 * This works only because secrets/local/ holds a development keypair. There is
 * no path here that touches a real environment.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { PERMISSIONS } from '@ssm/contracts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]!;
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.split('=').slice(1).join('=') : fallback;
}

const SECRETS = process.env.SSM_SECRETS_DIR ?? join(process.cwd(), 'secrets/local');

const tenantId = arg('tenant', '00000000-0000-4000-8000-0000000000ff');
const subject = arg('sub', '00000000-0000-4000-8000-000000000001');
const email = arg('email', 'admin@serigy.local');
const ttl = arg('ttl', '8h');

// --perms financial:invoice:read,financial:invoice:create
// Defaults to everything, which is what a development token is for; pass a
// narrow list to check that a guard actually refuses.
const permsArg = arg('perms', '');
const perms = permsArg ? permsArg.split(',').map((p) => p.trim()).filter(Boolean) : [...PERMISSIONS];

const privateKey = createPrivateKey(readFileSync(join(SECRETS, 'jwt_private_key.pem'), 'utf8'));

const token = await new SignJWT({
  sub: subject,
  tid: tenantId,
  email,
  name: arg('name', 'Administração da Plataforma'),
  roles: permsArg ? ['custom'] : ['platform:admin'],
  perms,
})
  .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
  .setIssuer(process.env.JWT_ISSUER ?? 'https://identity.ssm.local')
  .setAudience(process.env.JWT_AUDIENCE ?? 'ssm')
  .setIssuedAt()
  .setExpirationTime(ttl)
  .setJti(randomUUID())
  .sign(privateKey);

// stdout carries only the token, so `$(make -s token)` captures it cleanly.
process.stdout.write(token);
