import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  createEmployeeSchema,
  offboardEmployeeSchema,
  updateEmployeeSchema,
  type Employee,
  type EmployeeSafe,
  type Page,
} from '@ssm/contracts';
import {
  CurrentUser,
  CheckRevocation,
  Idempotent,
  RequirePermissions,
  TenantId,
  ZodValidationPipe,
  type AuthenticatedUser,
} from '@ssm/nest-common';
import {
  CreateEmployeeDto,
  EmployeeDto,
  EmployeePageDto,
  ListEmployeesQueryDto,
  OffboardEmployeeDto,
  UpdateEmployeeDto,
  listQuerySchema,
} from './employees.dto.js';
import { EmployeesService } from './employees.service.js';

@ApiTags('employees')
@ApiBearerAuth('bearer')
@Controller({ path: 'employees', version: '1' })
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions('hr:employee:read')
  @ApiOperation({
    summary: 'Lista colaboradores',
    description:
      'Sem a permissão `hr:payroll:read` a resposta omite dado pessoal e salário — os campos ' +
      'não vêm nulos, vêm ausentes, para que um cliente não os confunda com "sem valor".',
  })
  @ApiResponse({ status: 200, type: EmployeePageDto })
  list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListEmployeesQueryDto,
  ): Promise<Page<Employee | EmployeeSafe>> {
    const { limit, cursor, sort, ...filter } = query;
    return this.employees.list(
      tenantId,
      filter,
      { limit, cursor, sort },
      user.permissions.has('hr:payroll:read'),
    );
  }

  @Get(':id')
  @RequirePermissions('hr:employee:read')
  // A read is normally exempt from the revocation lookup, for the reasons in
  // TokenDenylistService. This one is not: with hr:payroll:read it returns
  // salary, national id and address — the most sensitive response in the
  // system, and worth a Redis round trip.
  @CheckRevocation()
  @ApiOperation({ summary: 'Obtém um colaborador' })
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Employee | EmployeeSafe> {
    return this.employees.findOne(tenantId, id, user.permissions.has('hr:payroll:read'));
  }

  @Post()
  @RequirePermissions('hr:employee:create')
  @ApiOperation({ summary: 'Cadastra um colaborador em onboarding' })
  @ApiResponse({ status: 201, type: EmployeeDto })
  @ApiResponse({ status: 409, description: 'E-mail corporativo já cadastrado.' })
  create(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Body(new ZodValidationPipe(createEmployeeSchema)) dto: CreateEmployeeDto,
  ): Promise<Employee> {
    return this.employees.create(tenantId, actorId, dto);
  }

  @Put(':id')
  @RequirePermissions('hr:employee:update')
  @ApiOperation({ summary: 'Altera um colaborador' })
  update(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) dto: UpdateEmployeeDto,
  ): Promise<Employee> {
    return this.employees.update(tenantId, actorId, id, dto);
  }

  @Post(':id/activate')
  @HttpCode(200)
  // Publishes hr.employee.hired, which the financial module consumes.
  @Idempotent()
  @RequirePermissions('hr:employee:update')
  @ApiOperation({
    summary: 'Conclui o onboarding',
    description: 'Publica `hr.employee.hired`.',
  })
  activate(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Employee> {
    return this.employees.activate(tenantId, actorId, id);
  }

  @Post(':id/offboard')
  @HttpCode(200)
  // Publishes hr.employee.offboarded, which stops recurring charges and flags
  // contracts. A duplicate would be seen by two other modules.
  @Idempotent()
  // Ending an employment relationship is not an ordinary edit.
  @RequirePermissions('hr:employee:delete')
  @ApiOperation({
    summary: 'Desliga o colaborador',
    description:
      'Mantém o cadastro como histórico e publica `hr.employee.offboarded`, que financeiro e ' +
      'jurídico consomem. Não há exclusão de colaborador.',
  })
  offboard(
    @TenantId() tenantId: string,
    @CurrentUser('id') actorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(offboardEmployeeSchema)) dto: OffboardEmployeeDto,
  ): Promise<Employee> {
    return this.employees.offboard(tenantId, actorId, id, dto);
  }
}
