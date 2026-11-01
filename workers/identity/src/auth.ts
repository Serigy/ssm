import {
  permissionsFor,
  visibleModules,
  type LoginRequest,
  type Session,
} from '@ssm/contracts';
import { HttpProblem, type BaseBindings, type Database, type DbStatement } from '@ssm/worker-common';
import { hashPassword, needsRehash, verifyPassword } from './passwords.js';
import { mintRefreshToken, sha256Hex, signAccessToken, type TokenUser } from './tokens.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  status: string;
  /** jsonb: o driver já devolve o array, sem JSON.parse. */
  roles: string[];
  failed_attempts: number;
  /** timestamptz, devolvido como ISO-8601 em UTC (ver database.ts). */
  locked_until: string | null;
}

interface RefreshRow {
  token_hash: string;
  user_id: string;
  tenant_id: string;
  family_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

export interface IssuedPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const now = () => new Date().toISOString();

function toTokenUser(row: UserRow): TokenUser {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    displayName: row.display_name,
    roles: row.roles,
  };
}

export async function login(
  env: BaseBindings,
  db: Database,
  dto: LoginRequest,
  meta: RequestMeta,
): Promise<IssuedPair> {
  // Sem tenantId de propósito: o login é o passo que descobre o tenant, e o
  // índice único (tenant_id, lower(email)) é por tenant. Tudo o que vem depois
  // filtra por `tenant_id` primeiro.
  const user = await db.prepare(
    'SELECT * FROM users WHERE lower(email) = lower(?)',
  )
    .bind(dto.email)
    .first<UserRow>();

  // Calcula o hash mesmo sem usuário, para o tempo de resposta não revelar
  // quais endereços estão cadastrados.
  if (!user) {
    await hashPassword(dto.password).catch(() => undefined);
    throw HttpProblem.unauthorized('E-mail ou senha inválidos.');
  }

  if (user.locked_until && user.locked_until > now()) {
    throw HttpProblem.forbidden(
      `Conta bloqueada até ${user.locked_until}. ` +
        'Aguarde ou peça a um administrador para desbloquear.',
    );
  }

  const valid = await verifyPassword(user.password_hash, dto.password).catch(() => false);
  if (!valid) {
    await registerFailure(db, user);
    throw HttpProblem.unauthorized('E-mail ou senha inválidos.');
  }

  if (user.status !== 'active') {
    throw HttpProblem.forbidden(
      `Esta conta está "${user.status}" e não pode entrar. Procure um administrador.`,
    );
  }

  const statements: DbStatement[] = [
    db.prepare(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?
        WHERE tenant_id = ? AND id = ?`,
    ).bind(now(), user.tenant_id, user.id),
  ];

  // Senha ainda com o custo antigo: refaz o hash agora que ela está em mãos.
  // É a única hora em que dá — o hash não é reversível.
  if (needsRehash(user.password_hash)) {
    statements.push(
      db.prepare('UPDATE users SET password_hash = ? WHERE tenant_id = ? AND id = ?').bind(
        await hashPassword(dto.password),
        user.tenant_id,
        user.id,
      ),
    );
  }
  await db.batch(statements);

  return issuePair(env, db, user, crypto.randomUUID(), meta);
}

/**
 * Rotaciona o refresh token.
 *
 * Apresentar um token já usado significa que ele vazou, então a família inteira
 * — todos os tokens descendentes daquele login — é revogada de uma vez.
 */
export async function refresh(
  env: BaseBindings,
  db: Database,
  rawToken: string,
  meta: RequestMeta,
): Promise<IssuedPair> {
  const hash = await sha256Hex(rawToken);
  // O hash é a chave e vem de um segredo de 256 bits: é a busca que descobre o
  // tenant, como o e-mail no login. Daqui em diante, tudo filtra por tenant.
  const stored = await db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?')
    .bind(hash)
    .first<RefreshRow>();

  if (!stored) throw HttpProblem.unauthorized('Sessão inválida. Entre novamente.');

  if (stored.used_at || stored.revoked_at) {
    console.warn(
      JSON.stringify({
        event: 'auth.refresh.reuse',
        familyId: stored.family_id,
        userId: stored.user_id,
      }),
    );
    await db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE tenant_id = ? AND family_id = ?')
      .bind(now(), stored.tenant_id, stored.family_id)
      .run();
    // O refresh vazou, então presume-se que o access token também vazou.
    await revokeUserBefore(env, stored.user_id);
    throw HttpProblem.unauthorized('Esta sessão foi encerrada por segurança. Entre novamente.');
  }

  if (stored.expires_at < now()) {
    throw HttpProblem.unauthorized('Sessão expirada. Entre novamente.');
  }

  const user = await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND id = ?')
    .bind(stored.tenant_id, stored.user_id)
    .first<UserRow>();

  if (!user || user.status !== 'active') {
    await db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE tenant_id = ? AND family_id = ?')
      .bind(now(), stored.tenant_id, stored.family_id)
      .run();
    throw HttpProblem.unauthorized('Conta indisponível.');
  }

  // Marcar como usado e emitir o próximo no mesmo batch: se a emissão falhar, o
  // token antigo continua válido em vez de a sessão morrer no meio.
  return issuePair(env, db, user, stored.family_id, meta, [
    db.prepare('UPDATE refresh_tokens SET used_at = ? WHERE tenant_id = ? AND token_hash = ?').bind(
      now(),
      stored.tenant_id,
      hash,
    ),
  ]);
}

/**
 * Revoga a família inteira, para todo dispositivo daquele login sair.
 *
 * Revogar só a família de refresh não basta: o access token que já está na
 * memória do navegador continua funcionando até expirar. A lista de revogação
 * fecha essa janela, que é justamente o que alguém que clica "Sair" depois de
 * perder um notebook espera que aconteça.
 */
export async function logout(env: BaseBindings, db: Database, rawToken: string): Promise<void> {
  const stored = await db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?')
    .bind(await sha256Hex(rawToken))
    .first<RefreshRow>();
  if (!stored) return;

  await db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE tenant_id = ? AND family_id = ?')
    .bind(now(), stored.tenant_id, stored.family_id)
    .run();
  await revokeUserBefore(env, stored.user_id);
}

export async function session(db: Database, tenantId: string, userId: string): Promise<Session> {
  const user = await db.prepare('SELECT * FROM users WHERE tenant_id = ? AND id = ?')
    .bind(tenantId, userId)
    .first<UserRow>();
  if (!user) throw HttpProblem.unauthorized('Sessão inválida.');

  const roles = user.roles;
  const perms = permissionsFor(roles);
  return {
    user: {
      id: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      displayName: user.display_name,
      roles,
    },
    permissions: [...perms],
    modules: visibleModules(perms),
  };
}

// --- internos ---------------------------------------------------------------

async function issuePair(
  env: BaseBindings,
  db: Database,
  user: UserRow,
  familyId: string,
  meta: RequestMeta,
  extra: DbStatement[] = [],
): Promise<IssuedPair> {
  const ttl = Number(env.ACCESS_TOKEN_TTL_SECONDS);
  const accessToken = await signAccessToken(env, toTokenUser(user));

  const raw = mintRefreshToken();
  const expiresAt = new Date(
    Date.now() + Number(env.REFRESH_TOKEN_TTL_SECONDS) * 1000,
  ).toISOString();

  await db.batch([
    ...extra,
    db.prepare(
      `INSERT INTO refresh_tokens (
         token_hash, user_id, tenant_id, family_id, expires_at, user_agent, ip_address
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      await sha256Hex(raw),
      user.id,
      user.tenant_id,
      familyId,
      expiresAt,
      meta.userAgent?.slice(0, 500) ?? null,
      meta.ip ?? null,
    ),
  ]);

  return { accessToken, refreshToken: raw, expiresIn: ttl };
}

async function registerFailure(db: Database, user: UserRow): Promise<void> {
  const attempts = user.failed_attempts + 1;
  const lock =
    attempts >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
      : user.locked_until;

  await db.prepare(
    'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE tenant_id = ? AND id = ?',
  )
    .bind(attempts, lock, user.tenant_id, user.id)
    .run();

  if (lock && attempts >= MAX_FAILED_ATTEMPTS) {
    console.warn(
      JSON.stringify({ event: 'auth.account.locked', userId: user.id, attempts }),
    );
  }
}

/**
 * Marca todo access token daquele usuário emitido até agora como inválido.
 *
 * Aqui o KV é a escolha certa, e é o único uso dele no sistema: a propagação de
 * cerca de um minuto significa que uma revogação demora até um minuto para
 * valer em todas as bordas, o que é aceitável — a alternativa seria consultar
 * um Durable Object a cada requisição mutante, trocando um minuto de atraso na
 * revogação por latência em toda escrita do sistema.
 *
 * A marca d'água expira junto com o access token mais longo possível: depois
 * disso, todo token daquele usuário já expirou por conta própria.
 */
async function revokeUserBefore(env: BaseBindings, userId: string): Promise<void> {
  const ttl = Number(env.ACCESS_TOKEN_TTL_SECONDS);
  await env.KV.put(`revoked:user:${userId}`, String(Math.floor(Date.now() / 1000)), {
    expirationTtl: Math.max(60, ttl + 60),
  });
}
