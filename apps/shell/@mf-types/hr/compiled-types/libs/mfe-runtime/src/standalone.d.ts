import { type ComponentType } from 'react';
/**
 * Host stub for running one remote on its own during development.
 *
 * It fakes exactly two things — the session and the notification sink — and
 * nothing else. In particular the ApiClient is real and talks to the real
 * gateway, because a module that only ever runs against mocks will meet the
 * actual API for the first time in production.
 *
 * The session it produces grants every permission the module declares, so a
 * developer sees the whole surface. That is the one place standalone differs
 * from the shell, and it is deliberate: permission filtering is the shell's job
 * and is tested there.
 */
export declare function StandaloneHost({ moduleId, permissions, Root, }: {
    moduleId: string;
    permissions: readonly string[];
    Root: ComponentType;
}): import("react").JSX.Element;
//# sourceMappingURL=standalone.d.ts.map