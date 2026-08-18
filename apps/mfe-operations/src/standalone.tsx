import { StandaloneHost } from '@ssm/mfe-runtime';
import definition from './module.js';

export function Standalone() {
  return (
    <StandaloneHost
      moduleId={definition.id}
      permissions={definition.permissions}
      Root={definition.Root}
    />
  );
}
