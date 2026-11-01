import { useCallback, useMemo, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  AppShell,
  Badge,
  Button,
  EmptyState,
  LoadingBar,
  useToast,
  type NavItem,
} from '@ssm/ui-kit';
import { HostProvider, RemoteSlot, type HostServices } from '@ssm/mfe-runtime';
import { LoginScreen } from './auth/LoginScreen.js';
import { useSession } from './auth/useSession.js';
import { Dashboard } from './layout/Dashboard.js';
import { REMOTES } from './remotes.js';

export function App() {
  const { status, session, api, signIn, signOut } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [pageTitle, setPageTitle] = useState<{ title: string; subtitle?: string }>({
    title: 'Visão geral',
  });

  /**
   * The services handed to every remote. Memoised on the session, not on every
   * render: a new object identity here would re-render all three modules on any
   * state change in the shell.
   */
  const host = useMemo<HostServices | null>(() => {
    if (!session) return null;
    return {
      api,
      session,
      navigate: (path) => navigate(path),
      notify: { success: toast.success, error: toast.error },
      setPageTitle: (title, subtitle) => setPageTitle({ title, subtitle }),
      can: (permission) => session.permissions.includes(permission),
      locale: 'pt-BR',
    };
  }, [api, session, navigate, toast, setPageTitle]);

  /** Only the modules this user has at least one permission for. */
  const visibleRemotes = useMemo(
    () => REMOTES.filter((r) => session?.modules.includes(r.id)),
    [session],
  );

  const nav = useMemo<NavItem[]>(
    () => [
      { id: 'overview', label: 'Visão geral', href: '/', group: 'Painel' },
      ...visibleRemotes.map((r) => ({
        id: r.id,
        label: r.label,
        href: r.basePath,
        group: 'Módulos',
      })),
    ],
    [visibleRemotes],
  );

  const activeId = useMemo(() => {
    const match = visibleRemotes.find((r) => location.pathname.startsWith(r.basePath));
    return match?.id ?? 'overview';
  }, [location.pathname, visibleRemotes]);

  const onNavigate = useCallback((item: NavItem) => navigate(item.href), [navigate]);

  if (status === 'loading') return <LoadingBar />;
  if (status === 'anonymous' || !session || !host) return <LoginScreen onSignIn={signIn} />;

  return (
    <HostProvider value={host}>
      <AppShell
        product="SERVICE MANAGER"
        nav={nav}
        activeId={activeId}
        onNavigate={onNavigate}
        title={pageTitle.title}
        subtitle={pageTitle.subtitle}
        user={{ name: session.user.displayName, email: session.user.email }}
        footLabel="AMBIENTE"
        footValue={import.meta.env.MODE.toUpperCase()}
        actions={
          <>
            <Badge tone="success" dot>
              Operacional
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sair
            </Button>
          </>
        }
      >
        <Routes>
          <Route path="/" element={<Dashboard />} />

          {/*
            Each remote owns everything under its base path. The trailing /*
            is what lets the module declare its own nested routes without the
            shell knowing any of them.
          */}
          {visibleRemotes.map((remote) => {
            // Root comes from the descriptor and is stable across renders —
            // see the note on RemoteDescriptor.Root. Creating it here instead
            // would re-suspend the module on every render of this component.
            const Root = remote.Root;
            return (
              <Route
                key={remote.id}
                path={`${remote.basePath}/*`}
                element={
                  // One boundary per module: a remote that fails to load takes
                  // only its own pane down, not the whole application.
                  <RemoteSlot moduleId={remote.id}>
                    {/*
                      Services go across as props, not through context. The
                      remote has its own copy of @ssm/mfe-runtime — and so its
                      own HostContext object — because a source-linked workspace
                      package cannot be shared through the federation scope.
                      See RemoteRootProps in libs/mfe-runtime.
                    */}
                    <Root services={host} />
                  </RemoteSlot>
                }
              />
            );
          })}

          <Route
            path="*"
            element={
              <EmptyState
                title="Página não encontrada"
                body="O endereço não corresponde a nenhuma tela disponível para o seu acesso."
                action={
                  <Button variant="secondary" onClick={() => navigate('/')}>
                    Voltar ao início
                  </Button>
                }
              />
            }
          />
        </Routes>
      </AppShell>
    </HostProvider>
  );
}
