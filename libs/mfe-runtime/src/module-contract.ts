import type { ComponentType } from 'react';
import type { Permission } from '@ssm/contracts';
import type { HostServices } from './host-context.js';

/**
 * Props the shell passes to a module's root component.
 *
 * The services are handed over EXPLICITLY, as props, rather than being read
 * from React context across the federation boundary. That is not a style
 * preference — it is the only arrangement that works:
 *
 * A workspace library linked to its TypeScript source is not resolvable
 * through Module Federation's share scope. The host serves its copy of
 * @ssm/mfe-runtime from its own dev server and the remote serves another from
 * its own, so `createContext()` runs twice and produces two distinct context
 * objects. The shell's <HostProvider> writes to one; the remote's useHost()
 * reads from the other and finds nothing. Declaring `singleton: true` on such
 * a package does not fix it, it just makes the failure surprising.
 *
 * Passing the services as props sidesteps module identity entirely. The remote
 * re-provides them through ITS OWN copy of the context, which is by definition
 * the same copy its own screens read from.
 */
export interface RemoteRootProps {
  services: HostServices;
}

/**
 * The contract between the shell and every remote.
 *
 * Each remote's Module Federation entry exposes `./Module` with a default
 * export of this shape. The shell knows nothing else about a module — which is
 * the whole point: a module can be rebuilt and redeployed without the shell
 * being rebuilt, as long as this contract holds.
 *
 * Changing this interface is a breaking change for every remote at once. Treat
 * it like a public API: additive fields only, and bump `contractVersion` when
 * that stops being possible.
 */
export interface SsmModuleDefinition {
  /** Must match the remote's name in the shell's federation config. */
  id: 'financial' | 'hr' | 'legal';
  /** Shown in the sidebar. Sentence case. */
  label: string;
  /** Mount path owned by this module, e.g. "/financial". */
  basePath: string;
  /**
   * The module's root component.
   *
   * It receives the host services as props and MUST re-provide them through
   * its own <HostProvider> before rendering anything that calls useHost() —
   * see RemoteRootProps for why that indirection is load-bearing.
   *
   * It renders its own routes relative to basePath, on the router instance the
   * shell owns, so there is one history stack and the back button behaves.
   */
  Root: ComponentType<RemoteRootProps>;
  /**
   * Sidebar entries this module contributes. The shell filters them by the
   * user's permissions before rendering, so a module never has to.
   */
  navigation: Array<{
    id: string;
    label: string;
    path: string;
    requires: Permission[];
  }>;
  /**
   * Every permission this module can use. The shell hides the module entirely
   * when the user holds none of them.
   */
  permissions: Permission[];
  contractVersion: 1;
}

export const MODULE_CONTRACT_VERSION = 1 as const;

/** Type-checks a module definition at its own build time. */
export function defineModule(def: SsmModuleDefinition): SsmModuleDefinition {
  if (def.contractVersion !== MODULE_CONTRACT_VERSION) {
    throw new Error(
      `Module "${def.id}" targets contract v${def.contractVersion} but the shell ` +
        `expects v${MODULE_CONTRACT_VERSION}. Rebuild the remote against the current runtime.`,
    );
  }
  return def;
}
