import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformModule } from '@ssm/nest-common';
import { buildTypeOrmOptions } from './database/data-source.js';
import { EmployeesModule } from './employees/employees.module.js';
import { FinancialConsumer } from './consumers/financial.consumer.js';

@Module({
  imports: [
    PlatformModule.forRoot({
      serviceName: 'hr-svc',
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
    EmployeesModule,
  ],
  providers: [FinancialConsumer],
})
export class AppModule {}
