import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PlatformModule, RedisService, RedisThrottlerStorage } from '@ssm/nest-common';
import { StatusController } from './status.controller.js';

@Module({
  imports: [
    PlatformModule.forRoot({
      serviceName: 'gateway',
      // The gateway holds no data and issues no presigned URLs.
      storage: false,
    }),
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          // Burst allowance for a page load that fans out to several endpoints.
          { name: 'short', ttl: 1_000, limit: 20 },
          // Sustained rate. Well above normal use, low enough to blunt scraping.
          { name: 'long', ttl: 60_000, limit: 300 },
        ],
        // Counters shared across replicas. Without this the gateway's three
        // pods each kept their own tally, so the effective limit was three
        // times what is written above and which pod answered was arbitrary.
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
  controllers: [StatusController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
