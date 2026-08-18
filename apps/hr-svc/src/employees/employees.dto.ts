import { createZodDto } from 'nestjs-zod';
import {
  createEmployeeSchema,
  employeeFilterSchema,
  employeeSchema,
  offboardEmployeeSchema,
  pageQuerySchema,
  pageSchema,
  updateEmployeeSchema,
} from '@ssm/contracts';

export class CreateEmployeeDto extends createZodDto(createEmployeeSchema) {}
export class UpdateEmployeeDto extends createZodDto(updateEmployeeSchema) {}
export class OffboardEmployeeDto extends createZodDto(offboardEmployeeSchema) {}
export class EmployeeDto extends createZodDto(employeeSchema) {}
export class EmployeePageDto extends createZodDto(pageSchema(employeeSchema)) {}

export const listQuerySchema = employeeFilterSchema.merge(pageQuerySchema);
export class ListEmployeesQueryDto extends createZodDto(listQuerySchema) {}
