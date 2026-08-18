import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CONFIG, type AppConfig } from '../config/app-config.js';
import { SecretsService } from '../secrets/secrets.service.js';
import { RedisService } from './redis.service.js';
import { TokenDenylistService } from './token-denylist.service.js';
import { IdempotencyService } from './idempotency.service.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

@Global()
@Module({
  providers: [
    {
      provide: RedisService,
      inject: [CONFIG, SecretsService],
      useFactory: (cfg: AppConfig, secrets: SecretsService) => new RedisService(cfg, secrets),
    },
    TokenDenylistService,
    IdempotencyService,
    // Global, but inert unless the route carries @Idempotent(). Registering it
    // here rather than per-controller means a new critical endpoint gets the
    // behaviour by adding one decorator, not by remembering a second wiring step.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [RedisService, TokenDenylistService, IdempotencyService],
})
export class RedisModule {}
