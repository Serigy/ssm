import { z } from 'zod';

/**
 * Bindings every SSM Worker receives.
 *
 * Bindings are not environment variables — they are live handles the runtime
 * injects, so there is nothing to parse and nothing that can be missing at
 * runtime without the deploy having failed first. What IS parsed here is the
 * plain-text configuration and the secrets, which behave like variables.
 */
export interface BaseBindings {
  /**
   * Banco SQLite do módulo. Um por contexto delimitado, como antes.
   *
   * Declarado obrigatório embora o gateway não tenha nenhum: ele é o único sem
   * banco, e afrouxar o tipo obrigaria os cinco módulos a asserção de não-nulo
   * em toda consulta para acomodar a exceção. A sonda de saúde em app.ts
   * verifica a presença em tempo de execução, que é onde a diferença aparece —
   * foi assim que o gateway ficou permanentemente "unavailable" por causa de um
   * banco que ele nunca deveria ter.
   */
  DB: D1Database;

  /**
   * Coordination state that tolerates eventual consistency.
   *
   * Only the token denylist lives here. KV propagates writes globally in about
   * a minute and has no atomic increment, which makes it wrong for rate limit
   * counters and for idempotency — a retry that arrives before propagation
   * would not see its own key. Those two use Durable Objects instead.
   */
  KV: KVNamespace;

  /** Documents. Same bucket the containerised version already used. */
  R2: R2Bucket;

  /** Serialises what SQLite cannot: counters, idempotency, sequences. */
  COORDINATOR: DurableObjectNamespace;

  /**
   * Acesso direto a cada módulo, só para a sonda de saúde do gateway.
   *
   * Presente apenas no Worker do gateway; nenhum módulo tem binding para outro
   * — a conversa entre eles é por fila, como manda o ADR 0002. Ver o comentário
   * em workers/gateway/src/index.ts para o motivo de não ser por URL.
   */
  SVC_IDENTITY?: Fetcher;
  SVC_FINANCIAL?: Fetcher;
  SVC_HR?: Fetcher;
  SVC_LEGAL?: Fetcher;
  SVC_OPERATIONS?: Fetcher;

  /** Outbound domain events. One queue per consuming module — see events.ts. */
  QUEUE_FINANCIAL: Queue;
  QUEUE_HR: Queue;
  QUEUE_LEGAL: Queue;
  QUEUE_OPERATIONS: Queue;
  QUEUE_IDENTITY: Queue;

  // --- plain configuration -------------------------------------------------
  ENVIRONMENT: 'dev' | 'hmg' | 'prd';
  SERVICE_NAME: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  ACCESS_TOKEN_TTL_SECONDS: string;
  REFRESH_TOKEN_TTL_SECONDS: string;
  CORS_ORIGINS: string;

  // --- secrets, set with `wrangler secret put` -----------------------------
  /** PEM, RS256. Only the identity Worker gets the private half. */
  JWT_PUBLIC_KEY: string;
  JWT_PRIVATE_KEY?: string;
  /** AES-GCM key for PII, base64. Only the hr Worker gets it. */
  PII_ENCRYPTION_KEY?: string;

  /**
   * Credenciais S3 do R2, para assinar URL de envio e de leitura.
   *
   * O binding `R2` acima serve para ler e escrever de dentro do Worker; ele não
   * assina URL. Quem precisa que o navegador fale direto com o balde — hoje o
   * Worker jurídico, com o PDF do contrato — usa estas.
   */
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
}

const configSchema = z.object({
  ENVIRONMENT: z.enum(['dev', 'hmg', 'prd']),
  SERVICE_NAME: z.string().min(1),
  JWT_ISSUER: z.string().url(),
  JWT_AUDIENCE: z.string().min(1),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1_209_600),
  CORS_ORIGINS: z.string(),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Validates the plain configuration once per request.
 *
 * There is no boot phase in a Worker — an isolate may be created for a single
 * request — so "fail fast at startup" has no place to happen. Validating here
 * turns a misconfigured deploy into a clear 500 on the first request instead of
 * an `undefined` propagating into a token's issuer claim.
 */
export function readConfig(env: BaseBindings): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida do Worker: ${issues}`);
  }
  return parsed.data;
}

export function isProduction(env: BaseBindings): boolean {
  return env.ENVIRONMENT === 'prd';
}
