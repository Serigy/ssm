import { defineModule } from '@ssm/mfe-runtime';
import { FinancialRoot } from './FinancialRoot.js';

/**
 * The module's entire public surface. The shell imports this file and nothing
 * else from the remote — everything below is free to change without a shell rebuild.
 */
export default defineModule({
  id: 'financial',
  label: 'Financeiro',
  basePath: '/financeiro',
  Root: FinancialRoot,
  navigation: [
    { id: 'invoices', label: 'Faturas', path: '/financeiro/faturas', requires: ['financial:invoice:read'] },
    { id: 'reports', label: 'Relatórios', path: '/financeiro/relatorios', requires: ['financial:report:export'] },
  ],
  permissions: [
    'financial:invoice:read',
    'financial:invoice:create',
    'financial:invoice:update',
    'financial:invoice:delete',
    'financial:invoice:approve',
    'financial:report:export',
  ],
  contractVersion: 1,
});
