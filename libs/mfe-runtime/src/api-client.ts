import type { Page, Problem } from '@ssm/contracts';

/**
 * The one HTTP client. Remotes never call fetch directly — they take this from
 * the host context, so token refresh, correlation ids and error normalisation
 * happen once instead of three times with three sets of bugs.
 */

export class ApiError extends Error {
  constructor(
    readonly problem: Problem,
    readonly status: number,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get isAuth(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isValidation(): boolean {
    return this.status === 422 || this.status === 400;
  }
  /** Field errors keyed by path, ready to hand to a form. */
  get fieldErrors(): Record<string, string[]> {
    return this.problem.errors ?? {};
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current access token, refreshing it if it is about to expire. */
  getToken: () => Promise<string | null>;
  /** Called when the server rejects the token and a refresh cannot fix it. */
  onUnauthorized: () => void;
}

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    init: RequestInit = {},
    idempotencyKey?: string,
  ): Promise<T> {
    const token = await this.opts.getToken();

    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // Lets a browser-side failure be found in the server logs.
    headers.set('X-Correlation-Id', crypto.randomUUID());

    /**
     * Idempotency key on every mutating request.
     *
     * Two kinds of key, and the difference matters:
     *
     *  - A caller-supplied key expresses "this is the same operation however
     *    many times it is attempted": issuing invoice X, activating employee Y.
     *    Clicking twice replays the first answer instead of erroring.
     *
     *  - The generated fallback is unique per call. It cannot dedupe a user
     *    clicking twice — those are two calls — but it does protect against the
     *    same HTTP request being delivered twice by a proxy or a browser
     *    resend, which is the case the server cannot otherwise distinguish
     *    from a genuine second request.
     *
     * Sending one unconditionally also means an endpoint that gains
     * @Idempotent() later does not suddenly start rejecting this client.
     */
    if (method !== 'GET' && method !== 'HEAD') {
      headers.set('Idempotency-Key', idempotencyKey ?? crypto.randomUUID());
    }

    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      ...init,
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    });

    if (res.status === 401) {
      this.opts.onUnauthorized();
      throw new ApiError(
        { type: 'about:blank', title: 'Sessão expirada', status: 401 },
        401,
      );
    }

    if (!res.ok) {
      // Every SSM error is application/problem+json. A non-JSON body means the
      // request never reached a service — an Ingress or a proxy answered.
      let problem: Problem;
      try {
        problem = (await res.json()) as Problem;
      } catch {
        problem = {
          type: 'about:blank',
          title: 'Não foi possível concluir a operação',
          status: res.status,
          detail: `O servidor respondeu ${res.status}. Tente novamente em alguns instantes.`,
        };
      }
      throw new ApiError(problem, res.status);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>('POST', path, body, {}, idempotencyKey);
  }
  put<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>('PUT', path, body, {}, idempotencyKey);
  }
  patch<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>('PATCH', path, body, {}, idempotencyKey);
  }
  delete<T>(path: string, idempotencyKey?: string): Promise<T> {
    return this.request<T>('DELETE', path, undefined, {}, idempotencyKey);
  }

  /** Convenience for the keyset-paginated list endpoints. */
  list<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<Page<T>> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const q = qs.toString();
    return this.get<Page<T>>(q ? `${path}?${q}` : path);
  }
}
