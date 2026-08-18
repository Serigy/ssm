import { lazy, type ComponentType } from 'react';
import type { SsmModuleDefinition } from '@ssm/mfe-runtime';

/**
 * The federated remotes.
 *
 * The specifiers are resolved at runtime by the Module Federation runtime
 * against the `remotes` entry in vite.config.ts; their types are declared in
 * remotes.d.ts, which is why the imports below type-check against nothing on disk.
 *
 * Each is loaded lazily, on first navigation into the module. A user who only
 * ever opens Financeiro never downloads a byte of Pessoas or Jurídico.
 */
export interface RemoteDescriptor {
  id: 'financial' | 'hr' | 'legal';
  label: string;
  basePath: string;
  load: () => Promise<{ default: SsmModuleDefinition }>;
}

export const REMOTES: RemoteDescriptor[] = [
  {
    id: 'financial',
    label: 'Financeiro',
    basePath: '/financeiro',
    load: () => import('financial/Module'),
  },
  {
    id: 'hr',
    label: 'Pessoas',
    basePath: '/pessoas',
    load: () => import('hr/Module'),
  },
  {
    id: 'legal',
    label: 'Jurídico',
    basePath: '/juridico',
    load: () => import('legal/Module'),
  },
];

/** Lazily-resolved root component for a remote, ready to render in a Suspense. */
export function lazyRoot(remote: RemoteDescriptor): ComponentType {
  return lazy(async () => {
    const mod = await remote.load();
    return { default: mod.default.Root };
  });
}
