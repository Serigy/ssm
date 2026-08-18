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
export declare class TokenStore {
    private readonly baseUrl;
    private accessToken;
    private expiresAt;
    private refreshInFlight;
    constructor(baseUrl: string);
    set(pair: TokenPair): void;
    clear(): void;
    get(): Promise<string | null>;
    private refresh;
}
export interface AuthState {
    status: 'loading' | 'authenticated' | 'anonymous';
    session: Session | null;
}
/** Permission check used by both the shell's nav filter and a module's guards. */
export declare function can(session: Session | null, permission: string): boolean;
export declare function canAny(session: Session | null, permissions: readonly string[]): boolean;
//# sourceMappingURL=auth-context.d.ts.map