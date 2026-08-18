import '@ssm/nest-common/zen-preload';

import { bootstrapService } from '@ssm/nest-common';
import { AppModule } from './app.module.js';
import { registerProxies } from './proxy/register-proxies.js';

void bootstrapService({
  serviceName: 'gateway',
  module: AppModule,
  // 'api' so the gateway's own routes land at /api/v1/status. The proxied
  // subtrees are unaffected: they are mounted as raw Express middleware ahead
  // of Nest's router, so /api/financial/... is forwarded verbatim and never
  // reaches this prefix.
  globalPrefix: 'api',
  // No cookie parsing here. The refresh cookie is forwarded verbatim by the
  // proxy to identity-svc, which is the only service that reads it — parsing it
  // at the gateway would add a dependency and a surface for no purpose.
  openapi: {
    title: 'SSM — Gateway',
    description:
      'Ponto único de entrada do navegador. Encaminha /api/identity, /api/financial, /api/hr ' +
      'e /api/legal para os serviços correspondentes, aplicando limite de requisições e as ' +
      'políticas de CORS e cabeçalhos. A especificação completa de cada módulo está no ' +
      'respectivo arquivo em docs/api/.',
    version: '1.0.0',
    tags: [{ name: 'gateway', description: 'Estado e roteamento' }],
  },
  // Proxy middleware must be mounted before Nest's router claims the paths.
  beforeListen: (app) => registerProxies(app),
});
