import { createZodDto } from 'nestjs-zod';
import {
  createEnvironmentSchema,
  environmentFilterSchema,
  environmentSchema,
  pageQuerySchema,
  pageSchema,
  scheduleWindowSchema,
  updateEnvironmentSchema,
} from '@ssm/contracts';

export class CreateEnvironmentDto extends createZodDto(createEnvironmentSchema) {}
export class UpdateEnvironmentDto extends createZodDto(updateEnvironmentSchema) {}
export class ScheduleWindowDto extends createZodDto(scheduleWindowSchema) {}
export class EnvironmentDto extends createZodDto(environmentSchema) {}
export class EnvironmentPageDto extends createZodDto(pageSchema(environmentSchema)) {}

export const listEnvironmentsQuerySchema = environmentFilterSchema.merge(pageQuerySchema);
export class ListEnvironmentsQueryDto extends createZodDto(listEnvironmentsQuerySchema) {}
