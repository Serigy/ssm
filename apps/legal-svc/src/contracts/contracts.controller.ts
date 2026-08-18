import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createContractSchema, updateContractSchema, type Contract, type Page } from '@ssm/contracts';
import {
  CurrentUser,
  CheckRevocation,
  Idempotent,
  RequirePermissions,
  TenantId,
  ZodValidationPipe,
} from '@ssm/nest-common';
import {
  AmendContractDto,
  AttachDocumentDto,
  ContractDto,
  ContractPageDto,
  CreateContractDto,
  ListContractsQueryDto,
  TransitionDto,
  UpdateContractDto,
  UploadRequestDto,
  amendSchema,
  attachSchema,
  listQuerySchema,
  transitionSchema,
  uploadRequestSchema,
} from './contracts.dto.js';
import { ContractsService } from './contracts.service.js';

@ApiTags('contracts')
@ApiBearerAuth('bearer')
@Controller({ path: 'contracts', version: '1' })
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @RequirePermissions('legal:contract:read')
  @ApiOperation({ summary: 'Lista contratos' })
  @ApiResponse({ status: 200, type: ContractPageDto })
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListContractsQueryDto,
  ): Promise<Page<Contract>> {
    const { limit, cursor, sort, ...filter } = query;
    return this.contracts.list(tenantId, filter, { limit, cursor, sort });
  }

  @Get('expiring')
  @RequirePermissions('legal:contract:read')
  @ApiOperation({
    summary: 'Contratos com vigência próxima do fim',
    description: 'Mesma consulta que alimenta o aviso diário, para que painel e alerta não divirjam.',
  })
  expiring(
    @TenantId() tenantId: string,
    @Query('withinDays') withinDays?: string,
  ): Promise<Contract[]> {
    return this.contracts.expiring(tenantId, withinDays ? Number(withinDays) : 60);
  }

  @Get(':id')
  @RequirePermissions('legal:contract:read')
  @ApiOperation({ summary: 'Obtém um contrato com a árvore de cláusulas' })
  @ApiResponse({ status: 200, type: ContractDto })
  findOne(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<Contract> {
    return this.contracts.findOne(tenantId, id);
  }

  @Post()
  @RequirePermissions('legal:contract:create')
  @ApiOperation({ summary: 'Cria um contrato em rascunho' })
  create(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Body(new ZodValidationPipe(createContractSchema)) dto: CreateContractDto,
  ): Promise<Contract> {
    return this.contracts.create(tenantId, actorId, dto);
  }

  @Put(':id')
  @RequirePermissions('legal:contract:update')
  @ApiOperation({ summary: 'Altera os metadados de um contrato não assinado' })
  @ApiResponse({ status: 409, description: 'Contrato ativo — registre um aditivo.' })
  update(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateContractSchema)) dto: UpdateContractDto,
  ): Promise<Contract> {
    return this.contracts.update(tenantId, actorId, id, dto);
  }

  @Post(':id/amend')
  @HttpCode(200)
  // A repeat would archive the same clause tree twice and bump the version
  // number for nothing.
  @Idempotent()
  @RequirePermissions('legal:contract:update')
  @ApiOperation({
    summary: 'Registra um aditivo',
    description:
      'Arquiva a árvore de cláusulas atual como versão e grava a nova. O histórico é mantido ' +
      'na íntegra — nunca em diffs — para reconstruir o texto vigente em qualquer data.',
  })
  amend(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(amendSchema)) dto: AmendContractDto,
  ): Promise<Contract> {
    return this.contracts.amend(tenantId, actorId, id, dto.clauses, dto.note);
  }

  @Post(':id/status')
  @HttpCode(200)
  // Activating publishes legal.contract.activated.
  @Idempotent()
  @RequirePermissions('legal:contract:approve')
  @ApiOperation({
    summary: 'Altera o estado do contrato',
    description: 'Ativar publica `legal.contract.activated`, consumido pelo financeiro.',
  })
  transition(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(transitionSchema)) dto: TransitionDto,
  ): Promise<Contract> {
    return this.contracts.transition(tenantId, actorId, id, dto.status);
  }

  @Post(':id/document/upload-url')
  @HttpCode(200)
  @RequirePermissions('legal:contract:update')
  @ApiOperation({
    summary: 'Emite uma URL assinada para envio do PDF',
    description:
      'O navegador envia o arquivo direto ao R2. O serviço nunca recebe o binário — ' +
      'nem em memória, nem em disco.',
  })
  uploadUrl(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(uploadRequestSchema)) dto: UploadRequestDto,
  ) {
    return this.contracts.uploadTicket(tenantId, id, dto.filename, dto.contentType);
  }

  @Post(':id/document')
  @HttpCode(200)
  @RequirePermissions('legal:contract:update')
  @ApiOperation({ summary: 'Confirma o envio e vincula o documento ao contrato' })
  attach(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(attachSchema)) dto: AttachDocumentDto,
  ): Promise<Contract> {
    return this.contracts.attachDocument(tenantId, actorId, id, dto.key);
  }

  @Get(':id/document')
  @RequirePermissions('legal:contract:read')
  // Presigned URL to a signed contract — same reasoning as the financial one.
  @CheckRevocation()
  @ApiOperation({ summary: 'Emite uma URL assinada de leitura para o PDF' })
  document(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.documentTicket(tenantId, id);
  }
}
