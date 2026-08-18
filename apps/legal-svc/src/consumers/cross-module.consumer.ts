import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SERVICE_BINDINGS, parseEventPayload } from '@ssm/contracts';
import { EventBusService } from '@ssm/nest-common';

@Injectable()
export class CrossModuleConsumer implements OnModuleInit {
  private readonly log = new Logger(CrossModuleConsumer.name);

  constructor(private readonly bus: EventBusService) {}

  async onModuleInit(): Promise<void> {
    this.bus.on('hr.employee.offboarded', async (raw) => {
      const p = parseEventPayload('hr.employee.offboarded', raw);
      // A departing employee may be a signatory or an obligation owner; those
      // contracts need a human to reassign them.
      this.log.log(
        `Colaborador ${p.employeeId} desligado — marcando para revisão os contratos ` +
          'em que ele figura como parte ou responsável por obrigação.',
      );
      // TODO(legal): sinalizar contratos com externalRef = employeeId.
    });

    this.bus.on('financial.invoice.issued', async (raw) => {
      const p = parseEventPayload('financial.invoice.issued', raw);
      this.log.debug(`Fatura ${p.number} emitida — conferindo obrigações de pagamento.`);
      // TODO(legal): baixar obrigação correspondente quando houver vínculo.
    });

    await this.bus.startConsumer([...(SERVICE_BINDINGS['legal-svc'] ?? [])]);
  }
}
