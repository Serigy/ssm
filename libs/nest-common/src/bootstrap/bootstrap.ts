import { INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig, type AppConfig } from '../config/app-config.js';
import { SsmLogger, createPinoLogger } from '../logging/logger.js';
import { ProblemDetailsFilter } from '../http/problem.filter.js';
import { applyHardening } from '../security/hardening.js';
import { assertZenInProduction, initZen } from '../security/zen.js';
import { setupOpenApi, type OpenApiOptions } from '../openapi/openapi.js';

export interface BootstrapOptions {
  serviceName: string;
  module: unknown;
  openapi: OpenApiOptions;
  /** Route prefix, e.g. 'api/financial'. Health probes stay outside it. */
  globalPrefix?: string;
  /** Body size cap. Documents go to R2 directly, so this stays small. */
  bodyLimit?: string;
  /** Enables cookie parsing. Only identity-svc needs it, for the refresh cookie. */
  cookies?: boolean;
  /** Runs after the app is configured but before it binds a port. */
  beforeListen?: (app: INestApplication) => void | Promise<void>;
}

/**
 * The one true way a service starts. Every main.ts is four lines because
 * everything that must be identical across services lives here.
 */
export async function bootstrapService(opts: BootstrapOptions): Promise<INestApplication> {
  const cfg: AppConfig = loadConfig({ SERVICE_NAME: opts.serviceName });

  // Refuse to serve production traffic without the in-app firewall.
  assertZenInProduction(cfg);

  const pino = createPinoLogger(cfg);
  const app = await NestFactory.create(opts.module as never, {
    logger: new SsmLogger(pino),
    bufferLogs: true,
  });

  initZen(cfg);
  applyHardening(app, cfg);

  if (opts.cookies) {
    // Required to read the HttpOnly refresh cookie. Loaded only where it is
    // needed so the other services carry no cookie-handling surface at all.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cookieParser = require('cookie-parser') as () => never;
    app.use(cookieParser());
  }

  app.setGlobalPrefix(opts.globalPrefix ?? '', {
    // Probes must stay reachable at a fixed path — the Kubernetes manifests
    // hardcode it and should not have to know each service's prefix.
    exclude: ['health/live', 'health/ready', 'health/startup', 'metrics'],
  });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // No global ValidationPipe.
  //
  // Nest's ValidationPipe is built on class-validator, and installing it would
  // mean two validation systems in one process — the decorators it reads do not
  // exist on these DTOs, so it would silently pass everything through while
  // pulling in a dependency nobody uses. Validation is Zod's job here, applied
  // per route with ZodValidationPipe against the schemas in @ssm/contracts.
  // See docs/adr/0008-zod-como-contrato.md.

  app.useGlobalFilters(new ProblemDetailsFilter());

  // Lets Nest run OnApplicationShutdown so the AMQP channel drains its acks
  // before the pod's SIGTERM grace period expires.
  app.enableShutdownHooks();

  setupOpenApi(app, cfg, opts.openapi);

  await opts.beforeListen?.(app);

  // Spec-emitting mode: write the file and stop, without binding a port.
  if (process.env.SSM_EMIT_OPENAPI) {
    await app.close();
    process.exit(0);
  }

  await app.listen(cfg.PORT, '0.0.0.0');
  pino.info(
    { port: cfg.PORT, env: cfg.NODE_ENV, prefix: opts.globalPrefix },
    `${opts.serviceName} listening on :${cfg.PORT}`,
  );

  return app;
}
