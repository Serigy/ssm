import { createContext, useContext, type ReactNode } from 'react';
import type { Session } from '@ssm/contracts';
import type { ApiClient } from './api-client.js';

/**
 * Everything the shell provides to a remote.
 *
 * This is deliberately small. A remote that needs something not in here should
 * fetch it itself — widening this interface couples all three modules to the
 * shell's release cycle, which defeats the point of federating them.
 */
export interface HostServices {
  api: ApiClient;
  session: Session;
  /** Navigate within the app without a full page load. */
  navigate: (path: string) => void;
  notify: {
    success: (title: string, body?: string) => void;
    error: (title: string, body?: string) => void;
  };
  /** Sets the topbar title while a module screen is mounted. */
  setPageTitle: (title: string, subtitle?: string) => void;
  can: (permission: string) => boolean;
  locale: string;
}

const HostContext = createContext<HostServices | null>(null);

export function HostProvider({
  value,
  children,
}: {
  value: HostServices;
  children: ReactNode;
}) {
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

/**
 * Throws rather than returning null when a remote is mounted outside the shell.
 * A remote rendered standalone in development must wrap itself in a
 * <HostProvider> with a stub — silently degrading would hide the mistake until
 * production.
 */
export function useHost(): HostServices {
  const ctx = useContext(HostContext);
  if (!ctx) {
    throw new Error(
      'useHost() called outside <HostProvider>. A remote mounted standalone must ' +
        'provide its own host stub — see libs/mfe-runtime/README.md.',
    );
  }
  return ctx;
}

export function useApi(): ApiClient {
  return useHost().api;
}
