import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppConfig } from '../config/app-config.js';

export interface OpenApiOptions {
  title: string;
  description: string;
  version?: string;
  /** Path the docs are served at. Disabled entirely in production. */
  path?: string;
  tags?: Array<{ name: string; description: string }>;
}

/**
 * Builds the OpenAPI document, serves Swagger UI outside production, and — when
 * SSM_EMIT_OPENAPI is set — writes the spec to docs/api/ and exits.
 *
 * That last mode is what `nx run <svc>:openapi` uses. The specs in docs/api are
 * generated artefacts checked into git, so a contract change shows up as a diff
 * in code review instead of being discovered by a client at runtime.
 */
export function setupOpenApi(
  app: INestApplication,
  cfg: AppConfig,
  opts: OpenApiOptions,
): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle(opts.title)
    .setDescription(opts.description)
    .setVersion(opts.version ?? '0.1.0')
    .setContact('Serigy Platform', 'https://ssm.serigy.net', 'platform@serigy.net')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'bearer',
    )
    .addServer('http://localhost:3000', 'Local gateway')
    .addServer('https://ssm.local', 'kind cluster')
    .addServer('https://api.ssm.serigy.net', 'Production');

  for (const t of opts.tags ?? []) builder.addTag(t.name, t.description);

  const document = SwaggerModule.createDocument(app, builder.build(), {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });

  const emitTo = process.env.SSM_EMIT_OPENAPI;
  if (emitTo) {
    mkdirSync(dirname(emitTo), { recursive: true });
    writeFileSync(emitTo, JSON.stringify(document, null, 2) + '\n', 'utf8');
    // eslint-disable-next-line no-console
    console.log(`OpenAPI spec written to ${emitTo}`);
  }

  // Swagger UI is an unauthenticated HTML surface. It has no place in production.
  if (cfg.NODE_ENV !== 'production') {
    SwaggerModule.setup(opts.path ?? 'docs', app, document, {
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', operationsSorter: 'alpha' },
      customSiteTitle: `${opts.title} — API`,
    });
  }

  return document;
}
