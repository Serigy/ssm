import '@ssm/nest-common/zen-preload';

import { bootstrapService } from '@ssm/nest-common';
import { AppModule } from './app.module.js';

void bootstrapService({
  serviceName: 'hr-svc',
  module: AppModule,
  globalPrefix: 'api/hr',
  openapi: {
    title: 'SSM — Recursos Humanos',
    description:
      'Cadastro de colaboradores, estrutura organizacional e ciclo de vida do vínculo. ' +
      'Campos de dado pessoal só são devolvidos a quem tem `hr:payroll:read`; para os demais ' +
      'a resposta é a projeção reduzida.',
    version: '1.0.0',
    tags: [
      { name: 'employees', description: 'Colaboradores e ciclo de vida do vínculo' },
      { name: 'departments', description: 'Estrutura organizacional' },
    ],
  },
});
