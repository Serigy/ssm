import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CONFIG, type AppConfig } from '../config/app-config.js';
import { SecretsService } from '../secrets/secrets.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtService } from './jwt.service.js';
import { PermissionsGuard } from './permissions.guard.js';

/**
 * Registers both guards globally. Order matters and is guaranteed by Nest:
 * providers registered earlier run first, so authentication precedes authorisation.
 */
@Global()
@Module({
  providers: [
    {
      provide: JwtService,
      inject: [SecretsService, CONFIG],
      useFactory: (secrets: SecretsService, cfg: AppConfig) => new JwtService(secrets, cfg),
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [JwtService],
})
export class SsmAuthModule {}
