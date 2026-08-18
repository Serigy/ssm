import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient, TokenStore, type AuthState } from '@ssm/mfe-runtime';
import type { LoginRequest, Session, TokenPair } from '@ssm/contracts';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * Owns the session for the whole application.
 *
 * On mount it attempts a silent refresh: the access token lives only in memory,
 * so a page reload always starts anonymous and must ask the HttpOnly refresh
 * cookie whether there is still a session. That one round-trip is the price of
 * keeping the token out of localStorage.
 */
export function useSession() {
  const [state, setState] = useState<AuthState>({ status: 'loading', session: null });

  const tokens = useMemo(() => new TokenStore(BASE_URL), []);

  const signOut = useCallback(async () => {
    await fetch(`${BASE_URL}/api/identity/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined);
    tokens.clear();
    setState({ status: 'anonymous', session: null });
  }, [tokens]);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: BASE_URL,
        getToken: () => tokens.get(),
        onUnauthorized: () => {
          tokens.clear();
          setState({ status: 'anonymous', session: null });
        },
      }),
    [tokens],
  );

  const loadSession = useCallback(async () => {
    try {
      const session = await api.get<Session>('/api/identity/v1/auth/me');
      setState({ status: 'authenticated', session });
    } catch {
      setState({ status: 'anonymous', session: null });
    }
  }, [api]);

  const signIn = useCallback(
    async (credentials: LoginRequest) => {
      const res = await fetch(`${BASE_URL}/api/identity/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(credentials),
      });

      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(
          problem?.detail ?? 'Não foi possível entrar. Verifique o e-mail e a senha.',
        );
      }

      tokens.set((await res.json()) as TokenPair);
      await loadSession();
    },
    [tokens, loadSession],
  );

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  return { ...state, api, signIn, signOut };
}
