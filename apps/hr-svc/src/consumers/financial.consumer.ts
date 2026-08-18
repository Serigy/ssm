import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SERVICE_BINDINGS } from '@ssm/contracts';
import { EventBusService } from '@ssm/nest-common';

@Injectable()
export class FinancialConsumer implements OnModuleInit {
  private readonly log = new Logger(FinancialConsumer.name);

  constructor(private readonly bus: EventBusService) {}

  async onModuleInit(): Promise<void> {
    this.bus.on('financial.payroll.*', async (_payload, envelope) => {
      this.log.log(`Evento de folha recebido: ${envelope.type} (${envelope.id}).`);
      // TODO(hr): conciliar a folha processada com o cadastro de colaboradores.
    });

    await this.bus.startConsumer([...(SERVICE_BINDINGS['hr-svc'] ?? [])]);
  }
}
