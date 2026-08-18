/**
 * The routing table. One entry per module service.
 *
 * The gateway is a reverse proxy, not a BFF: it does not aggregate, transform
 * or re-validate payloads. Every one of those would put module domain knowledge
 * into a component all three modules share, which is exactly the coupling this
 * architecture exists to avoid. Its jobs are auth-adjacent and operational —
 * one origin for the browser, rate limiting, CORS, headers, correlation.
 */
export interface ProxyRoute {
  /** Path prefix owned by this route, forwarded unchanged. */
  prefix: string;
  /** Environment variable holding the upstream base URL. */
  envVar: string;
  fallback: string;
  /** Longer for endpoints that legitimately take time (reports, exports). */
  timeoutMs?: number;
}

export const PROXY_ROUTES: ProxyRoute[] = [
  { prefix: '/api/identity', envVar: 'IDENTITY_URL', fallback: 'http://identity-svc:3001' },
  { prefix: '/api/financial', envVar: 'FINANCIAL_URL', fallback: 'http://financial-svc:3002' },
  { prefix: '/api/hr', envVar: 'HR_URL', fallback: 'http://hr-svc:3003' },
  { prefix: '/api/legal', envVar: 'LEGAL_URL', fallback: 'http://legal-svc:3004', timeoutMs: 30_000 },
];

export function upstreamFor(route: ProxyRoute): string {
  return process.env[route.envVar] ?? route.fallback;
}
