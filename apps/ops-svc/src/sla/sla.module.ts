import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEntity } from '../database/outbox.entity.js';
import { EnvironmentEntity } from '../environments/environment.entity.js';
import { TicketEntity } from '../tickets/ticket.entity.js';
import { SlaPeriodEntity } from './sla-period.entity.js';
import { SlaController } from './sla.controller.js';
import { SlaService } from './sla.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([SlaPeriodEntity, EnvironmentEntity, TicketEntity, OutboxEntity]),
  ],
  controllers: [SlaController],
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
