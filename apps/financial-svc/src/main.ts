// Zen must patch the module loader before anything else is imported —
// especially before `pg`, which it instruments to detect SQL injection.
import '@ssm/nest-common/zen-preload';

import { bootstrapService } from '@ssm/nest-common';
import { AppModule } from './app.module.js';

void bootstrapService({
  serviceName: 'financial-svc',
  module: AppModule,
  globalPrefix: 'api/financial',
  openapi: {
    title: 'SSM — Financial',
    description:
      'Faturamento, contas a receber e a pagar. Todos os valores trafegam como inteiros ' +
      'na menor unidade da moeda (centavos) com o código ISO-4217 — nunca como ponto flutuante.',
    version: '1.0.0',
    tags: [
      { name: 'invoices', description: 'Emissão, pagamento e cancelamento de faturas' },
      { name: 'reports', description: 'Posição de recebíveis e exportações' },
    ],
  },
});
