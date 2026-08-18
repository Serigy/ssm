import { createZodDto } from 'nestjs-zod';
import {
  createInvoiceSchema,
  invoiceFilterSchema,
  invoiceSchema,
  pageQuerySchema,
  pageSchema,
  recordPaymentSchema,
  updateInvoiceSchema,
} from '@ssm/contracts';
import { z } from 'zod';

/**
 * DTO classes exist only so @nestjs/swagger can describe the endpoints — the
 * validation and the types both come from the Zod schemas in @ssm/contracts.
 *
 * The alternative, class-validator decorators, would mean writing every shape
 * twice: once for the server and once for the micro-frontend that posts to it.
 * They would then drift, and the drift would surface as a 422 in production.
 */
export class CreateInvoiceDto extends createZodDto(createInvoiceSchema) {}
export class UpdateInvoiceDto extends createZodDto(updateInvoiceSchema) {}
export class RecordPaymentDto extends createZodDto(recordPaymentSchema) {}
export class InvoiceDto extends createZodDto(invoiceSchema) {}
export class InvoicePageDto extends createZodDto(pageSchema(invoiceSchema)) {}

export const listQuerySchema = invoiceFilterSchema.merge(pageQuerySchema);
export class ListInvoicesQueryDto extends createZodDto(listQuerySchema) {}

export const voidInvoiceSchema = z.object({
  reason: z.string().min(3).max(500),
});
export class VoidInvoiceDto extends createZodDto(voidInvoiceSchema) {}
