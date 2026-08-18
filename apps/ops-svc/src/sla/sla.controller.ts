import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { SlaPeriod } from '@ssm/contracts';
import {
  CurrentUser,
  Idempotent,
  RequirePermissions,
  TenantId,
  ZodValidationPipe,
} from '@ssm/nest-common';
import { ReckonSlaDto, SlaPeriodDto, reckonSchema } from './sla.dto.js';
import { SlaService } from './sla.service.js';

@ApiTags('sla')
@ApiBearerAuth('bearer')
@Controller({ path: 'sla', version: '1' })
export class SlaController {
  constructor(private readonly sla: SlaService) {}

  @Get()
  @RequirePermissions('operations:sla:read')
  @ApiOperation({ summary: 'Apurações de disponibilidade' })
  @ApiResponse({ status: 200, type: [SlaPeriodDto] })
  list(@TenantId() tenantId: string, @Query('month') month?: string): Promise<SlaPeriod[]> {
    return this.sla.list(tenantId, month);
  }

  @Post('reckon')
  @HttpCode(200)
  // Apurar exige aprovação: o resultado vira crédito na fatura do cliente.
  @RequirePermissions('operations:sla:approve')
  @Idempotent()
  @ApiOperation({
    summary: 'Apura a disponibilidade do mês para um ambiente',
    description:
      'A indisponibilidade é derivada dos chamados de severidade 1, não digitada — um ' +
      'número informado à mão é um número do qual se pode ser convencido. Incidentes ' +
      'sobrepostos são fundidos, e janelas agendadas saem do denominador. ' +
      'A apuração é gravada uma vez: reexecutar devolve o resultado guardado, porque ela ' +
      'vira crédito em uma fatura que o cliente já viu.',
  })
  @ApiResponse({ status: 200, type: SlaPeriodDto })
  reckon(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Body(new ZodValidationPipe(reckonSchema)) dto: ReckonSlaDto,
  ): Promise<SlaPeriod> {
    return this.sla.reckon(tenantId, actorId, {
      month: dto.month,
      environmentId: dto.environmentId,
      monthlyFeeMinor: dto.monthlyFee.amountMinor,
      currency: dto.monthlyFee.currency,
    });
  }
}
