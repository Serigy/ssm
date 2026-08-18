import { Global, Module } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/app-config.js';
import { SecretsService } from '../secrets/secrets.service.js';
import { EventBusService } from './event-bus.service.js';

@Global()
@Module({
  providers: [
    {
      provide: EventBusService,
      inject: [CONFIG, SecretsService],
      useFactory: (cfg: AppConfig, secrets: SecretsService) => new EventBusService(cfg, secrets),
    },
  ],
  exports: [EventBusService],
})
export class MessagingModule {}
