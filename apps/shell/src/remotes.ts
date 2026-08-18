import { lazy, type ComponentType } from 'react';
import type { RemoteRootProps, SsmModuleDefinition } from '@ssm/mfe-runtime';

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
  /**
   * The lazy root, created ONCE at module scope — never inside a render.
   *
   * React.lazy() returns a new component type on every call, and React keys
   * Suspense on component identity. Calling it during render therefore produces
   * a fresh type on each pass, so React unmounts the resolved tree and suspends
   * again immediately. The visible symptom is subtle and misleading: the module
   * really does mount and run its effects — the topbar title updates, the data
   * loads — but React marks the already-rendered subtree
   * `display: none !important` while it waits for the "new" lazy component, so
   * the screen stays blank.
   *
   * It becomes a loop the moment the module calls host.setPageTitle() in an
   * effect, because that re-renders the shell, which creates yet another lazy
   * component.
   */
  Root: ComponentType<RemoteRootProps>;
}

/** Wraps a federated import so the shell renders the module's Root directly. */
function lazyRoot(
  load: () => Promise<{ default: SsmModuleDefinition }>,
): ComponentType<RemoteRootProps> {
  return lazy(async () => ({ default: (await load()).default.Root }));
}

export const REMOTES: RemoteDescriptor[] = [
  {
    id: 'financial',
    label: 'Financeiro',
    basePath: '/financeiro',
    Root: lazyRoot(() => import('financial/Module')),
  },
  {
    id: 'hr',
    label: 'Pessoas',
    basePath: '/pessoas',
    Root: lazyRoot(() => import('hr/Module')),
  },
  {
    id: 'legal',
    label: 'Jurídico',
    basePath: '/juridico',
    Root: lazyRoot(() => import('legal/Module')),
  },
];
