import { Global, Module } from '@nestjs/common';
import { SecretsService } from './secrets.service.js';

/**
 * Global so that no feature module has to import it explicitly — a secret is
 * infrastructure, not a domain dependency.
 */
@Global()
@Module({
  providers: [{ provide: SecretsService, useFactory: () => new SecretsService() }],
  exports: [SecretsService],
})
export class SecretsModule {}
