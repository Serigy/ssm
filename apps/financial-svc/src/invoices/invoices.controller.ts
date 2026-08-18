import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  createInvoiceSchema,
  recordPaymentSchema,
  updateInvoiceSchema,
  type Invoice,
  type Page,
} from '@ssm/contracts';
import {
  CurrentUser,
  CheckRevocation,
  Idempotent,
  RequirePermissions,
  TenantId,
  ZodValidationPipe,
} from '@ssm/nest-common';
import {
  CreateInvoiceDto,
  InvoiceDto,
  InvoicePageDto,
  ListInvoicesQueryDto,
  RecordPaymentDto,
  UpdateInvoiceDto,
  VoidInvoiceDto,
  listQuerySchema,
  voidInvoiceSchema,
} from './invoices.dto.js';
import { InvoicesService } from './invoices.service.js';

@ApiTags('invoices')
@ApiBearerAuth('bearer')
@Controller({ path: 'invoices', version: '1' })
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions('financial:invoice:read')
  @ApiOperation({
    summary: 'Lista faturas',
    description:
      'Paginação por cursor (keyset). Passe `nextCursor` da resposta anterior em `cursor`; ' +
      'o cursor é opaco e não deve ser construído pelo cliente.',
  })
  @ApiResponse({ status: 200, type: InvoicePageDto })
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListInvoicesQueryDto,
  ): Promise<Page<Invoice>> {
    const { limit, cursor, sort, ...filter } = query;
    return this.invoices.list(tenantId, filter, { limit, cursor, sort });
  }

  @Get(':id')
  @RequirePermissions('financial:invoice:read')
  @ApiOperation({ summary: 'Obtém uma fatura' })
  @ApiResponse({ status: 200, type: InvoiceDto })
  @ApiResponse({ status: 404, description: 'Fatura inexistente ou de outro cliente.' })
  findOne(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Invoice> {
    return this.invoices.findOne(tenantId, id);
  }

  @Post()
  @RequirePermissions('financial:invoice:create')
  @ApiOperation({
    summary: 'Cria uma fatura em rascunho',
    description: 'Os totais são calculados no servidor; valores enviados pelo cliente são ignorados.',
  })
  @ApiResponse({ status: 201, type: InvoiceDto })
  create(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Body(new ZodValidationPipe(createInvoiceSchema)) dto: CreateInvoiceDto,
  ): Promise<Invoice> {
    return this.invoices.create(tenantId, actorId, dto);
  }

  @Put(':id')
  @RequirePermissions('financial:invoice:update')
  @ApiOperation({ summary: 'Altera um rascunho' })
  @ApiResponse({ status: 409, description: 'A fatura já foi emitida e não pode ser alterada.' })
  update(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateInvoiceSchema)) dto: UpdateInvoiceDto,
  ): Promise<Invoice> {
    return this.invoices.update(tenantId, actorId, id, dto);
  }

  @Post(':id/issue')
  @HttpCode(200)
  // A repeat assigns a second legal document number, or would if the state
  // machine let it. Idempotency turns the retry into a replay of the original
  // answer rather than a 409 the client has to interpret.
  @Idempotent()
  // Issuing assigns a legal document number and is irreversible — a stricter
  // permission than editing a draft.
  @RequirePermissions('financial:invoice:approve')
  @ApiOperation({
    summary: 'Emite a fatura',
    description:
      'Atribui o número sequencial do exercício, congela os valores e publica ' +
      '`financial.invoice.issued`. Não pode ser desfeito — use o cancelamento.',
  })
  issue(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Invoice> {
    return this.invoices.issue(tenantId, actorId, id);
  }

  @Post(':id/payments')
  @HttpCode(200)
  // The reason this exists at all: a lost response on a payment must not
  // become a second payment when the client retries.
  @Idempotent()
  @RequirePermissions('financial:invoice:update')
  @ApiOperation({ summary: 'Registra um pagamento, total ou parcial' })
  recordPayment(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(recordPaymentSchema)) dto: RecordPaymentDto,
  ): Promise<Invoice> {
    return this.invoices.recordPayment(tenantId, actorId, id, dto);
  }

  @Post(':id/void')
  @HttpCode(200)
  @Idempotent()
  @RequirePermissions('financial:invoice:approve')
  @ApiOperation({
    summary: 'Cancela a fatura',
    description: 'Mantém o registro e o número no histórico. Exige justificativa.',
  })
  voidInvoice(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(voidInvoiceSchema)) dto: VoidInvoiceDto,
  ): Promise<Invoice> {
    return this.invoices.void(tenantId, actorId, id, dto.reason);
  }

  @Get(':id/document')
  @RequirePermissions('financial:invoice:read')
  // Mints a presigned R2 URL that outlives the request and works without any
  // token at all. A revoked session must not be able to walk away with one.
  @CheckRevocation()
  @ApiOperation({
    summary: 'Emite um link temporário para o PDF',
    description:
      'Devolve uma URL assinada de curta duração no R2. O arquivo não passa pelo serviço.',
  })
  document(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.documentTicket(tenantId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('financial:invoice:delete')
  @ApiOperation({ summary: 'Exclui um rascunho' })
  @ApiResponse({ status: 409, description: 'Faturas emitidas são canceladas, não excluídas.' })
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.invoices.remove(tenantId, id);
  }
}
