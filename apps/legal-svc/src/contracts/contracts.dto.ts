import { createZodDto } from 'nestjs-zod';
import {
  clauseSchema,
  contractFilterSchema,
  contractSchema,
  contractStatusSchema,
  createContractSchema,
  pageQuerySchema,
  pageSchema,
  updateContractSchema,
} from '@ssm/contracts';
import { z } from 'zod';

export class CreateContractDto extends createZodDto(createContractSchema) {}
export class UpdateContractDto extends createZodDto(updateContractSchema) {}
export class ContractDto extends createZodDto(contractSchema) {}
export class ContractPageDto extends createZodDto(pageSchema(contractSchema)) {}

export const listQuerySchema = contractFilterSchema.merge(pageQuerySchema);
export class ListContractsQueryDto extends createZodDto(listQuerySchema) {}

export const amendSchema = z.object({
  clauses: z.array(clauseSchema),
  note: z.string().max(1000).optional(),
});
export class AmendContractDto extends createZodDto(amendSchema) {}

export const transitionSchema = z.object({ status: contractStatusSchema });
export class TransitionDto extends createZodDto(transitionSchema) {}

export const uploadRequestSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(3).max(100),
});
export class UploadRequestDto extends createZodDto(uploadRequestSchema) {}

export const attachSchema = z.object({ key: z.string().min(1).max(500) });
export class AttachDocumentDto extends createZodDto(attachSchema) {}
