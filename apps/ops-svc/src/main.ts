import '@ssm/nest-common/zen-preload';

import { bootstrapService } from '@ssm/nest-common';
import { AppModule } from './app.module.js';

void bootstrapService({
  serviceName: 'ops-svc',
  module: AppModule,
  globalPrefix: 'api/operations',
  openapi: {
    title: 'SSM — Operações',
    description:
      'Sustentação: inventário de ambientes, chamados com severidade e prazo, escala de ' +
      'plantão e apuração mensal de SLA. O alvo de disponibilidade vem do contrato no ' +
      'módulo Jurídico; o crédito por descumprimento é publicado para o Financeiro aplicar.',
    version: '1.0.0',
    tags: [
      { name: 'environments', description: 'Inventário de ambientes sob sustentação' },
      { name: 'tickets', description: 'Chamados, severidade e prazo de resposta' },
      { name: 'sla', description: 'Apuração mensal de disponibilidade' },
    ],
  },
});
