import * as Sentry from '@sentry/react';

/**
 * Inicializa o Sentry antes de qualquer outro módulo da aplicação.
 *
 * Só o shell inicializa: os remotes rodam na mesma página e os erros deles
 * chegam aos mesmos handlers globais, então uma segunda instância só duplicaria
 * eventos. Sem `VITE_SENTRY_DSN` o SDK fica inerte, que é o caso do dev.
 *
 * Replay fica de fora de propósito: as telas mostram CPF, folha e contrato.
 * Pelo mesmo motivo nada de cookie, cabeçalho, query ou corpo HTTP sai daqui.
 */
const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT ?? 'dev';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment,
  release: import.meta.env.VITE_SENTRY_RELEASE,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: environment === 'prd' ? 0.1 : 1,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
  },
});
