import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEntity } from '../database/outbox.entity.js';
import { EnvironmentEntity } from './environment.entity.js';
import { EnvironmentsController } from './environments.controller.js';
import { EnvironmentsService } from './environments.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([EnvironmentEntity, OutboxEntity])],
  controllers: [EnvironmentsController],
  providers: [EnvironmentsService],
  exports: [EnvironmentsService],
})
export class EnvironmentsModule {}
