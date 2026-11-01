import { createZodDto } from 'nestjs-zod';
import {
  amendContractSchema,
  attachDocumentSchema,
  contractFilterSchema,
  contractSchema,
  contractTransitionSchema,
  createContractSchema,
  pageQuerySchema,
  pageSchema,
  updateContractSchema,
  uploadRequestSchema,
} from '@ssm/contracts';

export class CreateContractDto extends createZodDto(createContractSchema) {}
export class UpdateContractDto extends createZodDto(updateContractSchema) {}
export class ContractDto extends createZodDto(contractSchema) {}
export class ContractPageDto extends createZodDto(pageSchema(contractSchema)) {}

export const listQuerySchema = contractFilterSchema.merge(pageQuerySchema);
export class ListContractsQueryDto extends createZodDto(listQuerySchema) {}

// A forma vem de @ssm/contracts; aqui só se acrescenta a classe que o Swagger
// do NestJS precisa para documentar o corpo.
export const amendSchema = amendContractSchema;
export class AmendContractDto extends createZodDto(amendSchema) {}

export const transitionSchema = contractTransitionSchema;
export class TransitionDto extends createZodDto(transitionSchema) {}

export { uploadRequestSchema };
export class UploadRequestDto extends createZodDto(uploadRequestSchema) {}

export const attachSchema = attachDocumentSchema;
export class AttachDocumentDto extends createZodDto(attachSchema) {}
