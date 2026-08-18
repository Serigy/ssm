import { defineModule } from '@ssm/mfe-runtime';
import { OperationsRoot } from './OperationsRoot.js';

export default defineModule({
  id: 'operations',
  label: 'Operações',
  basePath: '/operacoes',
  Root: OperationsRoot,
  navigation: [
    { id: 'environments', label: 'Ambientes', path: '/operacoes/ambientes', requires: ['operations:environment:read'] },
    { id: 'tickets', label: 'Chamados', path: '/operacoes/chamados', requires: ['operations:ticket:read'] },
    { id: 'sla', label: 'SLA', path: '/operacoes/sla', requires: ['operations:sla:read'] },
  ],
  permissions: [
    'operations:environment:read',
    'operations:environment:create',
    'operations:environment:update',
    'operations:environment:delete',
    'operations:ticket:read',
    'operations:ticket:create',
    'operations:ticket:update',
    'operations:ticket:delete',
    'operations:sla:read',
    'operations:sla:approve',
  ],
  contractVersion: 1,
});
