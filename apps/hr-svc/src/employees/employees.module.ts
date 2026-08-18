import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEntity } from '../database/outbox.entity.js';
import { OutboxRelay } from '../database/outbox.relay.js';
import { DepartmentEntity } from './department.entity.js';
import { EmployeeEntity } from './employee.entity.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([EmployeeEntity, DepartmentEntity, OutboxEntity])],
  controllers: [EmployeesController],
  providers: [EmployeesService, OutboxRelay],
  exports: [EmployeesService],
})
export class EmployeesModule {}
