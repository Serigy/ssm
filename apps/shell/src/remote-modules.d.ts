/**
 * Ambient declarations for the federated remotes.
 *
 * These specifiers are resolved at runtime by the Module Federation runtime
 * against the `remotes` entry in vite.config.ts — there are no files on disk
 * for TypeScript to find, so they have to be declared.
 *
 * Two constraints shape this file:
 *
 * 1. It must have no top-level import or export. A `declare module` inside a
 *    module file is read as an *augmentation* of an existing module, and an
 *    augmentation may not introduce exports — hence the inline `import('…')`
 *    type below rather than a top-level import.
 *
 * 2. It must NOT be named remotes.d.ts. TypeScript treats `x.d.ts` as the
 *    declaration output of a sibling `x.ts` and silently drops it from the
 *    program, so the declarations would never be seen.
 */
declare module 'financial/Module' {
  const definition: import('@ssm/mfe-runtime').SsmModuleDefinition;
  export default definition;
}

declare module 'hr/Module' {
  const definition: import('@ssm/mfe-runtime').SsmModuleDefinition;
  export default definition;
}

declare module 'legal/Module' {
  const definition: import('@ssm/mfe-runtime').SsmModuleDefinition;
  export default definition;
}
