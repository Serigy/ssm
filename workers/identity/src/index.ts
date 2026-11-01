import { loginRequestSchema } from '@ssm/contracts';
import {
  createApp,
  requireAuth,
  HttpProblem,
  Coordinator,
  type AppEnv,
} from '@ssm/worker-common';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { login, logout, refresh, session, type IssuedPair } from './auth.js';
import { pairResponse } from './tokens.js';

/** Nome do cookie HttpOnly que carrega o refresh token. */
const REFRESH_COOKIE = 'ssm_rt';
const COOKIE_PATH = '/api/identity/v1/auth';

/**
 * Limite de login por origem.
 *
 * São dois contadores, e a distinção entre eles foi aprendida na prática: a
 * primeira versão contava *tentativas* e limitava a 20 em 5 minutos por IP. A
 * suíte de navegador derrubou a própria sessão ao fazer alguns logins seguidos
 * — e o mesmo aconteceria com um escritório inteiro atrás de um NAT, que
 * compartilha um `cf-connecting-ip`. Numa segunda-feira de manhã a empresa
 * inteira ficaria de fora.
 *
 *   FALHAS    é o contador que importa contra ataque. Uma pulverização de
 *             senhas é feita de erros, então um teto baixo de erros por origem
 *             a corta rápido sem tocar em quem acerta a senha.
 *
 *   TENTATIVAS continua existindo, com teto alto, só para limitar o gasto de
 *             CPU: cada argon2id custa 394 ms, e sem nenhum teto uma origem
 *             conseguiria transformar o Worker numa conta de CPU.
 *
 * O bloqueio por conta, de 5 erros, resolve outro problema — ele protege uma
 * conta específica; estes dois protegem o serviço.
 */
const LOGIN_WINDOW_SECONDS = 300;
const LOGIN_MAX_FAILURES = 20;
const LOGIN_MAX_ATTEMPTS = 300;

const app = createApp('/api/identity');

app.post('/api/identity/v1/auth/login', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'desconhecido';
  const coordinator = c.get('coordinator');

  // Os dois tetos são conferidos ANTES do argon2id: conferir depois já teria
  // gasto a CPU que o limite existe para proteger.
  const [volume, failures] = await Promise.all([
    coordinator.checkRateLimit(`login:${ip}`, LOGIN_WINDOW_SECONDS, LOGIN_MAX_ATTEMPTS),
    coordinator.peekRateLimit(`login-fail:${ip}`, LOGIN_WINDOW_SECONDS, LOGIN_MAX_FAILURES),
  ]);
  const blocked = !volume.allowed || !failures.allowed;
  if (blocked) {
    const resetAt = Math.max(volume.resetAt, failures.resetAt);
    throw new HttpProblem(
      429,
      'TooManyRequests',
      'Tentativas de entrada demais desta origem. Aguarde alguns minutos.',
      { retryAfter: Math.ceil((resetAt - Date.now()) / 1000) },
    );
  }

  const dto = parse(loginRequestSchema, await c.req.json().catch(() => null));

  let pair;
  try {
    pair = await login(c.env, dto, {
      userAgent: c.req.header('user-agent'),
      ip: c.req.header('cf-connecting-ip'),
    });
  } catch (err) {
    // Só o erro conta. Um login que dá certo não é ataque, e contá-lo é o que
    // transformava um escritório inteiro em suspeito.
    await coordinator.checkRateLimit(`login-fail:${ip}`, LOGIN_WINDOW_SECONDS, LOGIN_MAX_FAILURES);
    throw err;
  }

  issue(c, pair);
  // O refresh token fica de fora do corpo de propósito: se ele nunca chega ao
  // JavaScript, um XSS não tem o que exfiltrar.
  return c.json(pairResponse(pair.accessToken, pair.expiresIn));
});

app.post('/api/identity/v1/auth/refresh', async (c) => {
  const token = getCookie(c, REFRESH_COOKIE);
  if (!token) {
    deleteCookie(c, REFRESH_COOKIE, { path: COOKIE_PATH });
    // 401, e não erro genérico. O shell chama isto a cada carregamento para
    // tentar entrar em silêncio, então "sem cookie" é o estado normal de quem
    // ainda não entrou — não é falha do servidor.
    throw HttpProblem.unauthorized('Sessão ausente. Entre novamente.');
  }

  const pair = await refresh(c.env, token, {
    userAgent: c.req.header('user-agent'),
    ip: c.req.header('cf-connecting-ip'),
  });
  issue(c, pair);
  return c.json(pairResponse(pair.accessToken, pair.expiresIn));
});

app.post('/api/identity/v1/auth/logout', async (c) => {
  const token = getCookie(c, REFRESH_COOKIE);
  if (token) await logout(c.env, token);
  deleteCookie(c, REFRESH_COOKIE, { path: COOKIE_PATH });
  return c.body(null, 204);
});

app.get('/api/identity/v1/auth/me', requireAuth(), async (c) =>
  c.json(await session(c.env, c.get('actor').id)),
);

/**
 * Grava o refresh token no cookie.
 *
 * `SameSite=Strict`, não `Lax`: este cookie só é enviado pela própria chamada
 * do aplicativo a /auth/refresh — nenhuma navegação precisa carregá-lo.
 * O caminho é restrito ao endpoint de autenticação para ele não viajar junto
 * com toda chamada de API.
 */
function issue(c: Context<AppEnv>, pair: IssuedPair): void {
  setCookie(c, REFRESH_COOKIE, pair.refreshToken, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: c.env.ENVIRONMENT !== 'dev',
    path: COOKIE_PATH,
    maxAge: Number(c.env.REFRESH_TOKEN_TTL_SECONDS),
  });
}

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw HttpProblem.badRequest(
      result.error.issues.map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return result.data;
}

export default {
  fetch: app.fetch,

  /**
   * Faxina das sessões vencidas.
   *
   * O serviço em contêiner não tinha isto e a tabela crescia para sempre: um
   * refresh token expirado há um mês não serve para nada e continua ocupando
   * linha e índice. No D1, onde o custo é por linha lida, isso vira dinheiro.
   */
  async scheduled(_c: ScheduledController, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(
      env.DB.prepare(
        `DELETE FROM refresh_tokens
          WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')`,
      )
        .run()
        .then((r) => {
          if (r.meta.changes) {
            console.log(
              JSON.stringify({ event: 'auth.refresh.swept', removed: r.meta.changes }),
            );
          }
        }),
    );
  },
} satisfies ExportedHandler<AppEnv['Bindings']>;

export { Coordinator };
