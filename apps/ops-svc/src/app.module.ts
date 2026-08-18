import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformModule } from '@ssm/nest-common';
import { buildTypeOrmOptions } from './database/data-source.js';
import { EnvironmentsModule } from './environments/environments.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { SlaModule } from './sla/sla.module.js';
import { CrossModuleConsumer } from './consumers/cross-module.consumer.js';

@Module({
  imports: [
    PlatformModule.forRoot({
      serviceName: 'ops-svc',
      // No documents yet; presigned URLs arrive with the runbook attachments.
      storage: false,
      checks: {
        postgres: async (ref) => {
          const { DataSource } = await import('typeorm');
          const ds = ref.get(DataSource, { strict: false });
          await ds.query('SELECT 1');
          return true;
        },
      },
    }),
    TypeOrmModule.forRootAsync({ useFactory: buildTypeOrmOptions }),
    EnvironmentsModule,
    TicketsModule,
    SlaModule,
  ],
  providers: [CrossModuleConsumer],
})
export class AppModule {}
