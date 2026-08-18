import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Contract, ContractSchema } from './contract.schema.js';
import { ContractsController } from './contracts.controller.js';
import { ContractsService } from './contracts.service.js';
import { ExpiryScheduler } from './expiry.scheduler.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: Contract.name, schema: ContractSchema }])],
  controllers: [ContractsController],
  providers: [ContractsService, ExpiryScheduler],
  exports: [ContractsService],
})
export class ContractsModule {}
