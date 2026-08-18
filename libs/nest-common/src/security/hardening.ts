import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { AppConfig } from '../config/app-config.js';

/**
 * HTTP hardening applied identically by every service. Centralised so that a
 * header policy change is one edit, not five.
 */
export function applyHardening(app: INestApplication, cfg: AppConfig): void {
  const prod = cfg.NODE_ENV === 'production' || cfg.NODE_ENV === 'staging';

  app.use(
    helmet({
      // The API serves JSON only; a restrictive CSP costs nothing here and
      // protects the Swagger UI, which is the one HTML surface these services expose.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: prod ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  const origins = cfg.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Same-origin and server-to-server calls arrive without an Origin header.
      if (!origin) return cb(null, true);
      cb(null, origins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Correlation-Id',
      'X-Tenant-Id',
      'If-Match',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Correlation-Id', 'ETag', 'Location'],
    maxAge: 600,
  });

  // Nest sets this by default; removing it denies a free fingerprint.
  app.getHttpAdapter().getInstance()?.disable?.('x-powered-by');
}
