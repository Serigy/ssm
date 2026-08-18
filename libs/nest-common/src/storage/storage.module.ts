import { Global, Module } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/app-config.js';
import { SecretsService } from '../secrets/secrets.service.js';
import { ObjectStorageService } from './object-storage.service.js';

@Global()
@Module({
  providers: [
    {
      provide: ObjectStorageService,
      inject: [CONFIG, SecretsService],
      useFactory: (cfg: AppConfig, secrets: SecretsService) =>
        new ObjectStorageService(cfg, secrets),
    },
  ],
  exports: [ObjectStorageService],
})
export class StorageModule {}
