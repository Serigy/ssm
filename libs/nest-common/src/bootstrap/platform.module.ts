import { MiddlewareConsumer, Module, NestModule, type DynamicModule } from '@nestjs/common';
import { CONFIG, loadConfig, type AppConfig } from '../config/app-config.js';
import { SecretsModule } from '../secrets/secrets.module.js';
import { SsmAuthModule } from '../auth/auth.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { HealthModule, type HealthModuleOptions } from '../health/health.module.js';
import { CorrelationMiddleware } from '../http/correlation.middleware.js';

export interface PlatformOptions extends HealthModuleOptions {
  serviceName: string;
  /** Set false for services that never touch object storage. */
  storage?: boolean;
}

/**
 * Everything a service needs before it has a single domain feature: config,
 * secrets, auth, correlation, the event bus, storage and the probes.
 *
 * A service's AppModule imports exactly this and its own feature modules — so
 * the platform behaves identically in all five, and a cross-cutting fix lands
 * once rather than five times.
 */
@Module({})
export class PlatformModule implements NestModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    const cfg = loadConfig({ SERVICE_NAME: options.serviceName });

    // Services that never touch object storage (gateway, identity-svc) opt out.
    // The export list has to follow the import list: Nest refuses to export a
    // module it was not given, so listing StorageModule unconditionally makes
    // those two services fail to bootstrap.
    const storage = options.storage === false ? [] : [StorageModule];

    return {
      module: PlatformModule,
      global: true,
      imports: [
        SecretsModule,
        // Before SsmAuthModule: the JWT guard resolves TokenDenylistService.
        RedisModule,
        SsmAuthModule,
        MessagingModule,
        ...storage,
        HealthModule.forRoot({ checks: options.checks }),
      ],
      providers: [{ provide: CONFIG, useValue: cfg }],
      exports: [CONFIG, SecretsModule, RedisModule, SsmAuthModule, MessagingModule, ...storage],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // '{*path}', not '*'. Nest 11 runs on Express 5, whose path-to-regexp
    // requires a named wildcard; a bare '*' is auto-converted with a warning
    // on every boot and is deprecated.
    consumer.apply(CorrelationMiddleware).forRoutes('{*path}');
  }
}

export type { AppConfig };
