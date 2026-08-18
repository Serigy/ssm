import type { Session, TokenPair } from '@ssm/contracts';

/**
 * Token handling.
 *
 * The access token is held in memory only — never in localStorage, where any
 * XSS on any page of the app can read it. The refresh token is an HttpOnly,
 * SameSite=Strict cookie set by identity-svc, so JavaScript cannot touch it at
 * all. The cost is that a page reload needs one refresh round-trip; that is a
 * fair price for removing the most commonly exploited token-theft path.
 */
export class TokenStore {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(private readonly baseUrl: string) {}

  set(pair: TokenPair): void {
    this.accessToken = pair.accessToken;
    // Refresh 60s early so a request never leaves with a token that expires
    // while it is in flight.
    this.expiresAt = Date.now() + (pair.expiresIn - 60) * 1000;
  }

  clear(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  async get(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.expiresAt) return this.accessToken;
    // Collapse concurrent refreshes: ten parallel requests on a stale token
    // must produce one refresh call, not ten.
    this.refreshInFlight ??= this.refresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async refresh(): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/identity/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        this.clear();
        return null;
      }
      const pair = (await res.json()) as TokenPair;
      this.set(pair);
      return pair.accessToken;
    } catch {
      this.clear();
      return null;
    }
  }
}

export interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  session: Session | null;
}

/** Permission check used by both the shell's nav filter and a module's guards. */
export function can(session: Session | null, permission: string): boolean {
  return session?.permissions.includes(permission) ?? false;
}

export function canAny(session: Session | null, permissions: readonly string[]): boolean {
  return permissions.some((p) => can(session, p));
}
