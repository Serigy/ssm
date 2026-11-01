import type { MiddlewareHandler } from 'hono';
import { HttpProblem } from './problem.js';
import type { AppEnv } from './app.js';

const HEADER = 'idempotency-key';

/**
 * Idempotência nas rotas em que repetir causa dano.
 *
 * Mesma semântica do IdempotencyInterceptor do NestJS — inclusive as respostas
 * de erro, porque as mesmas telas as consomem. O que mudou por baixo foi só o
 * armazenamento: era `SET NX` no Redis, agora é um Durable Object.
 *
 * A troca não é cosmética. O KV seria o análogo óbvio do Redis e é a escolha
 * errada aqui: ele é consistente no fim das contas, com propagação da ordem de
 * um minuto. Um cliente que tenta de novo dois segundos depois alcança uma
 * borda que ainda não viu a chave, e o pagamento entra duas vezes — exatamente
 * o que este cabeçalho existe para impedir. O Durable Object lê as próprias
 * escritas, sempre.
 */
export function idempotent(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header(HEADER);

    // Sem chave não há garantia. Recusar em vez de seguir em silêncio: nestas
    // rotas o cliente pediu uma promessa que o servidor não tem como cumprir às
    // cegas.
    if (!key) {
      throw HttpProblem.badRequest(
        `Esta operação exige o cabeçalho ${HEADER}. Gere um identificador único por ` +
          'tentativa e reenvie-o em cada nova tentativa da mesma operação.',
      );
    }
    if (key.length > 200) {
      throw HttpProblem.badRequest(`O cabeçalho ${HEADER} deve ter no máximo 200 caracteres.`);
    }

    const tenantId = c.get('actor')?.tenantId ?? 'anonymous';
    // O corpo é lido aqui e fica em cache no Hono, então a rota ainda consegue
    // lê-lo depois — um Request só pode ser consumido uma vez.
    const body = c.req.header('content-type')?.includes('json')
      ? await c.req.raw.clone().text()
      : '';
    const fingerprint = await sha256(
      `${c.req.method}\n${new URL(c.req.url).pathname}\n${body || 'null'}`,
    );

    const coordinator = c.get('coordinator');
    const lookup = await coordinator.claimIdempotency(tenantId, key, fingerprint);

    if (lookup.state === 'replay') {
      c.header('Idempotency-Replayed', 'true');
      return c.json(lookup.result.body as never, lookup.result.status as never);
    }
    if (lookup.state === 'in-flight') {
      throw HttpProblem.conflict(
        'Uma requisição com esta chave de idempotência ainda está em andamento. ' +
          'Aguarde a resposta antes de tentar de novo.',
      );
    }
    if (lookup.state === 'conflict') {
      throw HttpProblem.unprocessable(
        'Esta chave de idempotência já foi usada com um conteúdo diferente. ' +
          'Use uma chave nova para uma operação nova.',
      );
    }

    try {
      await next();
    } catch (err) {
      // Libera na falha, para o cliente poder repetir imediatamente. Gravar o
      // erro transformaria um 500 passageiro em permanente para aquela chave.
      await coordinator.releaseIdempotency(tenantId, key);
      throw err;
    }

    const status = c.res.status;
    if (status >= 200 && status < 300) {
      const saved = await c.res.clone().json().catch(() => null);
      await coordinator.completeIdempotency(tenantId, key, fingerprint, status, saved);
    } else {
      // 4xx também é resposta definitiva, mas guardá-la impediria o cliente de
      // corrigir o corpo e repetir — e a chave dele seria a mesma da tentativa
      // errada. Liberar é o comportamento útil.
      await coordinator.releaseIdempotency(tenantId, key);
    }
  };
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
