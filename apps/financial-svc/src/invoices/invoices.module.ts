import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceLineEntity } from './invoice-line.entity.js';
import { InvoiceEntity } from './invoice.entity.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { OutboxEntity } from '../database/outbox.entity.js';
import { OutboxRelay } from '../database/outbox.relay.js';

@Module({
  imports: [TypeOrmModule.forFeature([InvoiceEntity, InvoiceLineEntity, OutboxEntity])],
  controllers: [InvoicesController],
  providers: [InvoicesService, OutboxRelay],
  exports: [InvoicesService],
})
export class InvoicesModule {}
