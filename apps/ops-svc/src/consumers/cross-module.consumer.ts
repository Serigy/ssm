import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SERVICE_BINDINGS, parseEventPayload } from '@ssm/contracts';
import { EventBusService } from '@ssm/nest-common';

/**
 * What operations learns from the other modules.
 *
 * All of it is reconciliation rather than enforcement: none of these references
 * is a foreign key, because the records live in other services' databases. The
 * events are how the gap gets noticed and put in front of a human.
 */
@Injectable()
export class CrossModuleConsumer implements OnModuleInit {
  private readonly log = new Logger(CrossModuleConsumer.name);

  constructor(private readonly bus: EventBusService) {}

  async onModuleInit(): Promise<void> {
    this.bus.on('legal.contract.activated', async (raw) => {
      const p = parseEventPayload('legal.contract.activated', raw);
      // The contract carries the availability target and the response times.
      // Until an operator links it to an environment, operations is measuring
      // against a default rather than against what was signed.
      this.log.log(
        `Contrato ${p.reference} entrou em vigência. Vincule os ambientes cobertos para que ` +
          'a apuração de SLA use a meta contratada, e não a padrão.',
      );
    });

    this.bus.on('legal.contract.expiring', async (raw) => {
      const p = parseEventPayload('legal.contract.expiring', raw);
      this.log.warn(
        `Contrato ${p.reference} vence em ${p.daysRemaining} dias. Os ambientes vinculados ` +
          'ficam sem cobertura de sustentação se não houver renovação.',
      );
    });

    this.bus.on('hr.employee.offboarded', async (raw) => {
      const p = parseEventPayload('hr.employee.offboarded', raw);
      // The most operationally urgent of the three: a ticket assigned to
      // someone who left is a ticket nobody is working on, and the SLA clock
      // does not care that the assignee resigned.
      this.log.warn(
        `Colaborador ${p.employeeId} desligado em ${p.lastDay}. Reatribua os chamados abertos ` +
          'e retire-o da escala de plantão.',
      );
    });

    await this.bus.startConsumer([...(SERVICE_BINDINGS['ops-svc'] ?? [])]);
  }
}
