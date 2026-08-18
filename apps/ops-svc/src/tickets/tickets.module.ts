import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEntity } from '../database/outbox.entity.js';
import { OutboxRelay } from '../database/outbox.relay.js';
import { EnvironmentEntity } from '../environments/environment.entity.js';
import { TicketEntity } from './ticket.entity.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';
import { BreachScanner } from './breach.scanner.js';

@Module({
  imports: [TypeOrmModule.forFeature([TicketEntity, EnvironmentEntity, OutboxEntity])],
  controllers: [TicketsController],
  providers: [TicketsService, OutboxRelay, BreachScanner],
  exports: [TicketsService],
})
export class TicketsModule {}
