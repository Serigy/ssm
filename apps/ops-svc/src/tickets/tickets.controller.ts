import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createTicketSchema, transitionTicketSchema, type Page, type Ticket } from '@ssm/contracts';
import {
  CurrentUser,
  Idempotent,
  RequirePermissions,
  TenantId,
  ZodValidationPipe,
} from '@ssm/nest-common';
import {
  AssignTicketDto,
  CreateTicketDto,
  ListTicketsQueryDto,
  TicketDto,
  TicketPageDto,
  TransitionTicketDto,
  assignSchema,
  listTicketsQuerySchema,
} from './tickets.dto.js';
import { TicketsService } from './tickets.service.js';

@ApiTags('tickets')
@ApiBearerAuth('bearer')
@Controller({ path: 'tickets', version: '1' })
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @RequirePermissions('operations:ticket:read')
  @ApiOperation({
    summary: 'Lista chamados',
    description:
      'Ordenado por severidade e depois por abertura: um sev1 em aberto vai para o topo ' +
      'independentemente de quando chegou, que é como o plantão lê esta tela.',
  })
  @ApiResponse({ status: 200, type: TicketPageDto })
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(listTicketsQuerySchema)) query: ListTicketsQueryDto,
  ): Promise<Page<Ticket>> {
    const { limit, cursor, sort, ...filter } = query;
    return this.tickets.list(tenantId, filter, { limit, cursor, sort });
  }

  @Get(':id')
  @RequirePermissions('operations:ticket:read')
  @ApiOperation({ summary: 'Obtém um chamado com a linha do tempo' })
  @ApiResponse({ status: 200, type: TicketDto })
  findOne(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<Ticket> {
    return this.tickets.findOne(tenantId, id);
  }

  @Post()
  @RequirePermissions('operations:ticket:create')
  @ApiOperation({
    summary: 'Abre um chamado',
    description:
      'O prazo de primeira resposta é calculado na abertura, a partir da severidade e do ' +
      'alvo do ambiente. Um sev1 coloca o ambiente em incidente.',
  })
  @ApiResponse({ status: 201, type: TicketDto })
  create(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Body(new ZodValidationPipe(createTicketSchema)) dto: CreateTicketDto,
  ): Promise<Ticket> {
    return this.tickets.create(tenantId, actorId, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('operations:ticket:update')
  // Resolving publishes operations.incident.resolved and may return the
  // environment to operational — a repeat would do both twice.
  @Idempotent()
  @ApiOperation({
    summary: 'Altera o estado do chamado',
    description:
      'A primeira saída de "open" é registrada como a primeira resposta, e é contra ela ' +
      'que o prazo do contrato é apurado.',
  })
  transition(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(transitionTicketSchema)) dto: TransitionTicketDto,
  ): Promise<Ticket> {
    return this.tickets.transition(tenantId, actorId, id, dto.status, dto.note);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions('operations:ticket:update')
  @ApiOperation({ summary: 'Atribui o chamado a um colaborador' })
  assign(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assignSchema)) dto: AssignTicketDto,
  ): Promise<Ticket> {
    return this.tickets.assign(tenantId, actorId, id, dto.assigneeId);
  }
}
