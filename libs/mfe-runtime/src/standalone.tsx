import { useMemo, type ComponentType } from 'react';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import type { Session } from '@ssm/contracts';
import { ApiClient } from './api-client.js';
import { HostProvider, type HostServices } from './host-context.js';
import type { RemoteRootProps } from './module-contract.js';

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
export function StandaloneHost({
  moduleId,
  permissions,
  Root,
}: {
  moduleId: string;
  permissions: readonly string[];
  Root: ComponentType<RemoteRootProps>;
}) {
  return (
    <BrowserRouter>
      <Inner moduleId={moduleId} permissions={permissions} Root={Root} />
    </BrowserRouter>
  );
}

function Inner({
  moduleId,
  permissions,
  Root,
}: {
  moduleId: string;
  permissions: readonly string[];
  Root: ComponentType<RemoteRootProps>;
}) {
  const navigate = useNavigate();

  const host = useMemo<HostServices>(() => {
    const session: Session = {
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        tenantId: '00000000-0000-4000-8000-0000000000ff',
        email: 'dev@serigy.local',
        displayName: 'Desenvolvimento Local',
        roles: ['platform:admin'],
      },
      permissions: [...permissions],
      modules: [moduleId],
    };

    return {
      api: new ApiClient({
        baseUrl: '',
        // Standalone has no login screen. Point VITE_DEV_TOKEN at a token
        // obtained from `make token` when the endpoints require one.
        getToken: async () => import.meta.env.VITE_DEV_TOKEN ?? null,
        onUnauthorized: () => {
          // eslint-disable-next-line no-console
          console.warn(
            '[standalone] 401 do gateway. Gere um token com `make token` e exporte ' +
              'VITE_DEV_TOKEN antes de subir o remote isolado.',
          );
        },
      }),
      session,
      navigate: (path) => navigate(path),
      notify: {
        // eslint-disable-next-line no-console
        success: (title, body) => console.info(`[toast] ${title}`, body ?? ''),
        // eslint-disable-next-line no-console
        error: (title, body) => console.error(`[toast] ${title}`, body ?? ''),
      },
      setPageTitle: (title, subtitle) => {
        document.title = `${title} — ${moduleId} (standalone)`;
        void subtitle;
      },
      can: (permission) => permissions.includes(permission),
      locale: 'pt-BR',
    };
  }, [moduleId, permissions, navigate]);

  // Standalone provides the context too, because a remote run on its own is
  // not inside the shell's provider — but the Root still re-provides from its
  // own copy, exactly as it does under federation.
  return (
    <HostProvider value={host}>
      <div className="ssm-shell">
        <div className="ssm-shell__main">
          <header className="ssm-topbar">
            <div className="ssm-topbar__spacer">
              <div className="ssm-topbar__title">{moduleId}</div>
              <div className="ssm-topbar__subtitle">
                MODO ISOLADO — SEM SHELL, SEM FILTRO DE PERMISSÃO
              </div>
            </div>
          </header>
          <main className="ssm-content">
            <Root services={host} />
          </main>
        </div>
      </div>
    </HostProvider>
  );
}
