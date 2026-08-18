import type { Page, Problem } from '@ssm/contracts';
/**
 * The one HTTP client. Remotes never call fetch directly — they take this from
 * the host context, so token refresh, correlation ids and error normalisation
 * happen once instead of three times with three sets of bugs.
 */
export declare class ApiError extends Error {
    readonly problem: Problem;
    readonly status: number;
    constructor(problem: Problem, status: number);
    get isAuth(): boolean;
    get isForbidden(): boolean;
    get isValidation(): boolean;
    /** Field errors keyed by path, ready to hand to a form. */
    get fieldErrors(): Record<string, string[]>;
}
export interface ApiClientOptions {
    baseUrl: string;
    /** Returns the current access token, refreshing it if it is about to expire. */
    getToken: () => Promise<string | null>;
    /** Called when the server rejects the token and a refresh cannot fix it. */
    onUnauthorized: () => void;
}
export declare class ApiClient {
    private readonly opts;
    constructor(opts: ApiClientOptions);
    request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T>;
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    put<T>(path: string, body?: unknown): Promise<T>;
    patch<T>(path: string, body?: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
    /** Convenience for the keyset-paginated list endpoints. */
    list<T>(path: string, params?: Record<string, string | number | undefined>): Promise<Page<T>>;
}
//# sourceMappingURL=api-client.d.ts.map