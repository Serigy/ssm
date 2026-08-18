import { Logger, type INestApplication } from '@nestjs/common';
import { createProxyMiddleware, type Options } from 'http-proxy-middleware';
import { CORRELATION_HEADER, correlationId } from '@ssm/nest-common';
import { PROXY_ROUTES, upstreamFor } from './routes.js';

const log = new Logger('Proxy');

/**
 * Mounts one reverse proxy per module.
 *
 * Streaming matters here: `http-proxy-middleware` pipes the request and
 * response through without buffering, so a large report download does not sit
 * in the gateway's heap. That rules out doing this with an HTTP client and
 * re-emitting the body.
 */
export function registerProxies(app: INestApplication): void {
  const instance = app.getHttpAdapter().getInstance();

  for (const route of PROXY_ROUTES) {
    const target = upstreamFor(route);

    const options: Options = {
      target,
      changeOrigin: true,
      // The service owns the same prefix, so the path is forwarded verbatim.
      pathRewrite: undefined,
      proxyTimeout: route.timeoutMs ?? 15_000,
      timeout: route.timeoutMs ?? 15_000,
      xfwd: true,
      // The browser talks WebSocket to nothing yet; enabling it would widen the
      // surface for no current benefit.
      ws: false,

      on: {
        proxyReq: (proxyReq, req) => {
          // Carry the correlation id upstream so the whole path shares a trace.
          proxyReq.setHeader(CORRELATION_HEADER, correlationId());
          // Strip anything a client tried to spoof about its own identity.
          // Only the signed bearer token establishes who the caller is.
          proxyReq.removeHeader('x-tenant-id');
          proxyReq.removeHeader('x-actor-id');
          proxyReq.removeHeader('x-user-id');
        },

        error: (err, _req, res) => {
          log.error(`Upstream ${target} falhou: ${err.message}`);
          if ('writeHead' in res && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/problem+json' });
            res.end(
              JSON.stringify({
                type: 'https://ssm.serigy.io/problems/upstream-unavailable',
                title: 'Serviço indisponível',
                status: 502,
                detail:
                  'O módulo não respondeu. Os demais seguem disponíveis. ' +
                  'Tente novamente em alguns instantes.',
                traceId: correlationId(),
              }),
            );
          }
        },
      },
    };

    instance.use(route.prefix, createProxyMiddleware(options));
    log.log(`${route.prefix} -> ${target}`);
  }
}
