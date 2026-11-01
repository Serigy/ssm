import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { BaseBindings } from './env.js';
import type { Actor } from './auth.js';
import { HttpProblem, problemResponse } from './problem.js';
import { CoordinatorClient } from './coordinator-client.js';
import { databaseMiddleware, type Database } from './database.js';

export type AppEnv = {
  Bindings: BaseBindings;
  Variables: {
    actor: Actor;
    traceId: string;
    coordinator: CoordinatorClient;
    /** Só existe nos módulos já no Postgres (`createApp(base, { postgres: true })`). */
    db: Database;
  };
};

/**
 * A moldura comum a todo Worker do SSM.
 *
 * O que o gateway em contêiner fazia e onde foi parar:
 *
 *   roteamento    -> rotas do Cloudflare, na configuração; não há proxy
 *   TLS           -> a borda, de graça
 *   rate limit    -> Durable Object (por ator) + regras da WAF (volumétrico)
 *   CORS          -> aqui
 *   cabeçalhos    -> aqui
 *   correlação    -> aqui
 *   idempotência  -> Durable Object, no middleware `idempotent()`
 *   remover header forjado -> não existe mais; ver o bloco adiante
 */
export function createApp(basePath?: string, options: { postgres?: boolean } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Módulo no Neon: abre a conexão (preguiçosa) da requisição e a fecha ao fim.
  // Vem primeiro para a sonda de saúde, registrada adiante, também enxergá-la.
  if (options.postgres) app.use('*', databaseMiddleware());

  app.use('*', async (c, next) => {
    // Um id de correlação por cadeia causal, como antes. Só aceita o do cliente
    // se for um UUID: caso contrário, qualquer um envenena o índice do log.
    const incoming = c.req.header('x-correlation-id');
    const traceId = incoming && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : crypto.randomUUID();
    c.set('traceId', traceId);
    c.set('coordinator', new CoordinatorClient(c.env));
    c.header('X-Correlation-Id', traceId);
    await next();
  });

  app.use('*', secureHeaders({
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'no-referrer',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  }));

  app.use('*', async (c, next) => {
    const origins = c.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
    return cors({
      origin: (origin) => (origin && origins.includes(origin) ? origin : origins[0] ?? ''),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: [
        'Authorization', 'Content-Type', 'X-Correlation-Id', 'Idempotency-Key', 'If-Match',
      ],
      exposeHeaders: ['X-Correlation-Id', 'ETag', 'Location', 'Idempotency-Replayed'],
      maxAge: 600,
    })(c, next);
  });

  /*
   * Não há middleware apagando x-tenant-id e afins, por dois motivos.
   *
   * O primeiro é que não dá: no runtime dos Workers os cabeçalhos da requisição
   * são imutáveis, e `headers.delete()` lança "Can't modify immutable headers".
   *
   * O segundo é que não precisa. No desenho em contêiner o gateway apagava
   * esses cabeçalhos porque *encaminhava* a requisição a outro serviço que
   * poderia lê-los. Aqui não há encaminhamento: o Worker que recebe é o que
   * autoriza, e a identidade sai exclusivamente de `requireAuth`, que a lê das
   * claims verificadas. Nenhum caminho de código consulta esses cabeçalhos.
   *
   * A garantia deixou de ser um passo que alguém executa e passou a ser uma
   * propriedade da estrutura — que é a versão mais forte das duas.
   */
  app.onError((err, c) => problemResponse(c as Context, err, c.get('traceId') ?? crypto.randomUUID()));
  /**
   * Rota não registrada é 404, e não 500.
   *
   * A versão anterior passava um Error anônimo para o problemResponse, que só
   * reconhece HttpProblem — todo o resto vira "erro inesperado" com 500. O
   * efeito era um caminho digitado errado parecer falha de servidor, tanto para
   * quem chama quanto para quem monitora, e cada 404 legítimo somava ao gráfico
   * de erro do serviço.
   */
  app.notFound((c) =>
    problemResponse(
      c as Context,
      HttpProblem.notFound(`Nenhuma rota atende ${c.req.method} ${new URL(c.req.url).pathname}.`),
      c.get('traceId') ?? crypto.randomUUID(),
    ),
  );

  /**
   * Sonda de saúde. Sem `live` nem `startup`: não há processo para travar nem
   * para inicializar — um isolate morto simplesmente não recebe requisição.
   * Sobra o que ainda faz sentido perguntar: as dependências respondem?
   */
  /**
   * A sonda responde em dois caminhos, e o segundo não é conveniência.
   *
   * Em produção a borda só encaminha `/api/<modulo>/*` para o Worker; um GET em
   * `/health/ready` no domínio cai no Pages, que devolve o index.html. O
   * gateway perguntaria a saúde para o front-end e receberia HTML — a página de
   * estado diria "no ar" para um módulo desligado, que é pior do que não ter
   * página de estado.
   */
  const health = async (c: Context<AppEnv>) => {
    const checks: Record<string, 'up' | 'down'> = {};

    // Só se pergunta pelo que o Worker realmente tem. O gateway não declara D1
    // — ele não guarda nada — e a versão anterior o deixava permanentemente
    // "unavailable" por causa de um banco que ele nunca deveria ter. Uma sonda
    // que reprova um serviço saudável é pior que sonda nenhuma: ela impede o
    // deploy e ensina a ignorar o alarme.
    if (c.env.DB) {
      try {
        await c.env.DB.prepare('SELECT 1').first();
        checks.d1 = 'up';
      } catch {
        checks.d1 = 'down';
      }
    }
    // Módulo no Postgres: a conexão da requisição, aberta pelo middleware.
    if (options.postgres) {
      try {
        await c.get('db').prepare('SELECT 1').first();
        checks.postgres = 'up';
      } catch {
        checks.postgres = 'down';
      }
    }
    if (c.env.KV) {
      try {
        await c.env.KV.get('__probe');
        checks.kv = 'up';
      } catch {
        checks.kv = 'down';
      }
    }
    const failed = Object.values(checks).filter((v) => v === 'down');
    return c.json(
      {
        status: failed.length ? 'unavailable' : 'ok',
        service: c.env.SERVICE_NAME,
        environment: c.env.ENVIRONMENT,
        checks,
      },
      failed.length ? 503 : 200,
    );
  };

  app.get('/health/ready', health);
  if (basePath) app.get(`${basePath}/health/ready`, health);

  return app;
}
