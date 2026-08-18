import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlatformModule, SecretsService, loadConfig } from '@ssm/nest-common';
import mongoose from 'mongoose';
import { ContractsModule } from './contracts/contracts.module.js';
import { CrossModuleConsumer } from './consumers/cross-module.consumer.js';

@Module({
  imports: [
    PlatformModule.forRoot({
      serviceName: 'legal-svc',
      checks: {
        // readyState 1 means connected. Unlike TypeORM, mongoose's default
        // connection is a module-level singleton, so this really is the
        // connection the service is using.
        mongodb: async () => mongoose.connection.readyState === 1,
      },
    }),
    MongooseModule.forRootAsync({
      useFactory: () => {
        const cfg = loadConfig({ SERVICE_NAME: 'legal-svc' });
        const secrets = new SecretsService(cfg.SSM_SECRETS_DIR);
        const pass = encodeURIComponent(secrets.require('mongo_password'));
        const user = encodeURIComponent(cfg.MONGO_USER);

        return {
          uri: `mongodb://${user}:${pass}@${cfg.MONGO_HOST}:${cfg.MONGO_PORT}/${cfg.MONGO_DB}?authSource=admin`,
          // Fail a query rather than queue it forever when the primary is gone.
          serverSelectionTimeoutMS: 5_000,
          // Every write must reach the journal on a majority before it is
          // acknowledged: a contract that "saved" and then vanished on failover
          // is not acceptable in a legal record.
          writeConcern: { w: 'majority', j: true },
          readPreference: 'primaryPreferred',
          autoIndex: cfg.NODE_ENV === 'development',
        };
      },
    }),
    ContractsModule,
  ],
  providers: [CrossModuleConsumer],
})
export class AppModule {}
