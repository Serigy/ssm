import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  createEnvironmentSchema,
  scheduleWindowSchema,
  updateEnvironmentSchema,
  type Environment,
  type Page,
} from '@ssm/contracts';
import {
  CurrentUser,
  Idempotent,
  RequirePermissions,
  TenantId,
  ZodValidationPipe,
} from '@ssm/nest-common';
import {
  CreateEnvironmentDto,
  EnvironmentDto,
  EnvironmentPageDto,
  ListEnvironmentsQueryDto,
  ScheduleWindowDto,
  UpdateEnvironmentDto,
  listEnvironmentsQuerySchema,
} from './environments.dto.js';
import { EnvironmentsService } from './environments.service.js';

@ApiTags('environments')
@ApiBearerAuth('bearer')
@Controller({ path: 'environments', version: '1' })
export class EnvironmentsController {
  constructor(private readonly environments: EnvironmentsService) {}

  @Get()
  @RequirePermissions('operations:environment:read')
  @ApiOperation({
    summary: 'Inventário de ambientes',
    description: 'Ambientes em incidente vêm primeiro — é para isso que esta tela existe.',
  })
  @ApiResponse({ status: 200, type: EnvironmentPageDto })
  list(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(listEnvironmentsQuerySchema)) query: ListEnvironmentsQueryDto,
  ): Promise<Page<Environment>> {
    const { limit, cursor, sort, ...filter } = query;
    return this.environments.list(tenantId, filter, { limit, cursor, sort });
  }

  @Get(':id')
  @RequirePermissions('operations:environment:read')
  @ApiOperation({ summary: 'Obtém um ambiente' })
  @ApiResponse({ status: 200, type: EnvironmentDto })
  findOne(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<Environment> {
    return this.environments.findOne(tenantId, id);
  }

  @Post()
  @RequirePermissions('operations:environment:create')
  @ApiOperation({ summary: 'Provisiona um ambiente sob sustentação' })
  @ApiResponse({ status: 201, type: EnvironmentDto })
  @ApiResponse({ status: 409, description: 'Código já usado por outro ambiente.' })
  create(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Body(new ZodValidationPipe(createEnvironmentSchema)) dto: CreateEnvironmentDto,
  ): Promise<Environment> {
    return this.environments.create(tenantId, actorId, dto);
  }

  @Put(':id')
  @RequirePermissions('operations:environment:update')
  @ApiOperation({ summary: 'Altera um ambiente' })
  update(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEnvironmentSchema)) dto: UpdateEnvironmentDto,
  ): Promise<Environment> {
    return this.environments.update(tenantId, actorId, id, dto);
  }

  @Post(':id/window')
  @HttpCode(200)
  @RequirePermissions('operations:environment:update')
  @Idempotent()
  @ApiOperation({
    summary: 'Agenda uma janela de manutenção',
    description:
      'Indisponibilidade dentro da janela sai da apuração de disponibilidade. É por isso ' +
      'que ela é declarada antes e não discutida depois — e por isso um ambiente em ' +
      'incidente não aceita agendamento.',
  })
  @ApiResponse({ status: 409, description: 'Ambiente em incidente, ou janela invertida.' })
  scheduleWindow(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(scheduleWindowSchema)) dto: ScheduleWindowDto,
  ): Promise<Environment> {
    return this.environments.scheduleWindow(tenantId, actorId, id, dto);
  }
}
