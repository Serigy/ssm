import * as Sentry from '@sentry/cloudflare';
import type { BaseBindings } from './env.js';

/**
 * Monitoramento de erros e desempenho de todo Worker.
 *
 * O padrão do SDK coleta cookies, cabeçalhos, query e corpo HTTP. Aqui trafegam
 * CPF, folha e contrato, e o cookie de refresh é uma credencial, então nada
 * disso sai: o Sentry recebe a exceção, o stack e a rota, e o traceId liga o
 * evento ao log. Sem `SENTRY_DSN` o SDK fica inerte, que é o caso do dev.
 */
export function withMonitoring<H extends object>(handler: H): H {
  return Sentry.withSentry(
    (env: BaseBindings) => ({
      dsn: env.SENTRY_DSN,
      environment: env.ENVIRONMENT,
      tracesSampleRate: env.ENVIRONMENT === 'prd' ? 0.1 : 1,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
      },
      initialScope: { tags: { service: env.SERVICE_NAME } },
    }),
    handler as never,
  ) as H;
}

/**
 * O `onError` do Hono e os consumidores de fila tratam a exceção, então ela
 * nunca chega ao wrapper. Só o erro inesperado passa por aqui: um HttpProblem é
 * o sistema funcionando, e contá-lo soterraria o que importa.
 */
export function captureUnexpected(err: unknown, traceId: string): void {
  Sentry.withScope((scope) => {
    scope.setTag('traceId', traceId);
    Sentry.captureException(err);
  });
}
