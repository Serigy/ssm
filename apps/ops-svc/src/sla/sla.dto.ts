import { createZodDto } from 'nestjs-zod';
import { moneySchema, slaPeriodSchema, uuidSchema } from '@ssm/contracts';
import { z } from 'zod';

export class SlaPeriodDto extends createZodDto(slaPeriodSchema) {}

export const reckonSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/, 'Use o primeiro dia do mês, como 2026-08-01.'),
  environmentId: uuidSchema,
  /** The contract's monthly fee — the base the penalty percentage applies to. */
  monthlyFee: moneySchema,
});
export class ReckonSlaDto extends createZodDto(reckonSchema) {}
