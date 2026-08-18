import { defineModule } from '@ssm/mfe-runtime';
import { LegalRoot } from './LegalRoot.js';

export default defineModule({
  id: 'legal',
  label: 'Jurídico',
  basePath: '/juridico',
  Root: LegalRoot,
  navigation: [
    { id: 'contracts', label: 'Contratos', path: '/juridico/contratos', requires: ['legal:contract:read'] },
    { id: 'expiring', label: 'Vencimentos', path: '/juridico/vencimentos', requires: ['legal:contract:read'] },
  ],
  permissions: [
    'legal:contract:read',
    'legal:contract:create',
    'legal:contract:update',
    'legal:contract:delete',
    'legal:contract:approve',
  ],
  contractVersion: 1,
});
