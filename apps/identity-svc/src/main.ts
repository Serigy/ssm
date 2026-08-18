import '@ssm/nest-common/zen-preload';

import { bootstrapService } from '@ssm/nest-common';
import { AppModule } from './app.module.js';

void bootstrapService({
  serviceName: 'identity-svc',
  module: AppModule,
  globalPrefix: 'api/identity',
  // The refresh token lives in an HttpOnly cookie; this is the only service
  // that reads one.
  cookies: true,
  openapi: {
    title: 'SSM — Identidade',
    description:
      'Autenticação, usuários e papéis. Este é o único serviço que possui a chave privada ' +
      'de assinatura: os demais apenas verificam com a chave pública, offline.',
    version: '1.0.0',
    tags: [
      { name: 'auth', description: 'Login, refresh e encerramento de sessão' },
      { name: 'users', description: 'Usuários e atribuição de papéis' },
    ],
  },
});
