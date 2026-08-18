import { defineModule } from '@ssm/mfe-runtime';
import { HrRoot } from './HrRoot.js';

export default defineModule({
  id: 'hr',
  label: 'Pessoas',
  basePath: '/pessoas',
  Root: HrRoot,
  navigation: [
    { id: 'employees', label: 'Colaboradores', path: '/pessoas/colaboradores', requires: ['hr:employee:read'] },
    { id: 'payroll', label: 'Folha', path: '/pessoas/folha', requires: ['hr:payroll:read'] },
  ],
  permissions: [
    'hr:employee:read',
    'hr:employee:create',
    'hr:employee:update',
    'hr:employee:delete',
    'hr:payroll:read',
    'hr:payroll:approve',
  ],
  contractVersion: 1,
});
