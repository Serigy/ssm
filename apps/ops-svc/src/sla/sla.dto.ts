import { createZodDto } from 'nestjs-zod';
import { reckonSlaSchema, slaPeriodSchema } from '@ssm/contracts';

export class SlaPeriodDto extends createZodDto(slaPeriodSchema) {}

// A forma vem de @ssm/contracts; aqui fica só a classe que o Swagger precisa.
export const reckonSchema = reckonSlaSchema;
export class ReckonSlaDto extends createZodDto(reckonSchema) {}
