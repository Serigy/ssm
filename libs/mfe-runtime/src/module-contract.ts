import type { ComponentType } from 'react';
import type { Permission } from '@ssm/contracts';

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
   * The module's root component. It renders its own routes *relative* to
   * basePath, using the router instance the shell passes down — one router for
   * the whole app, so the back button behaves.
   */
  Root: ComponentType;
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
