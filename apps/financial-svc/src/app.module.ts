import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformModule } from '@ssm/nest-common';
import { InvoicesModule } from './invoices/invoices.module.js';
import { buildTypeOrmOptions } from './database/data-source.js';
import { HrConsumer } from './consumers/hr.consumer.js';

@Module({
  imports: [
    PlatformModule.forRoot({
      serviceName: 'financial-svc',
      checks: {
        // Probes the DataSource Nest actually opened, resolved from the
        // container. Importing the exported AppDataSource instead would probe
        // a second instance that is never initialised — a check that can only
        // ever report "down".
        postgres: async (ref) => {
          const { DataSource } = await import('typeorm');
          const ds = ref.get(DataSource, { strict: false });
          await ds.query('SELECT 1');
          return true;
        },
      },
    }),
    TypeOrmModule.forRootAsync({ useFactory: buildTypeOrmOptions }),
    InvoicesModule,
  ],
  providers: [HrConsumer],
})
export class AppModule {}
