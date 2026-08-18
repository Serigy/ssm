import { createZodDto } from 'nestjs-zod';
import {
  createTicketSchema,
  pageQuerySchema,
  pageSchema,
  ticketFilterSchema,
  ticketSchema,
  transitionTicketSchema,
} from '@ssm/contracts';
import { z } from 'zod';

export class CreateTicketDto extends createZodDto(createTicketSchema) {}
export class TransitionTicketDto extends createZodDto(transitionTicketSchema) {}
export class TicketDto extends createZodDto(ticketSchema) {}
export class TicketPageDto extends createZodDto(pageSchema(ticketSchema)) {}

export const listTicketsQuerySchema = ticketFilterSchema.merge(pageQuerySchema);
export class ListTicketsQueryDto extends createZodDto(listTicketsQuerySchema) {}

export const assignSchema = z.object({ assigneeId: z.string().uuid().nullable() });
export class AssignTicketDto extends createZodDto(assignSchema) {}
