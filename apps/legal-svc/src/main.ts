import '@ssm/nest-common/zen-preload';

import { bootstrapService } from '@ssm/nest-common';
import { AppModule } from './app.module.js';

void bootstrapService({
  serviceName: 'legal-svc',
  module: AppModule,
  globalPrefix: 'api/legal',
  openapi: {
    title: 'SSM — Jurídico',
    description:
      'Contratos, cláusulas, obrigações e vigências. O documento assinado fica no R2; ' +
      'o MongoDB guarda a árvore de cláusulas e o histórico de versões. ' +
      'Ver docs/adr/0004-postgres-e-mongodb.md para o porquê da escolha.',
    version: '1.0.0',
    tags: [
      { name: 'contracts', description: 'Ciclo de vida do contrato' },
      { name: 'obligations', description: 'Obrigações extraídas das cláusulas' },
    ],
  },
});
