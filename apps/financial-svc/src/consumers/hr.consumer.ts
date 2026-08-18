import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBusService } from '@ssm/nest-common';
import { SERVICE_BINDINGS, parseEventPayload } from '@ssm/contracts';

/**
 * Reacts to events from the other modules.
 *
 * Financial needs to know when someone leaves the company so that recurring
 * charges tied to them stop, and when a contract is activated so the billing
 * schedule can be created. It learns both by subscribing — never by calling
 * hr-svc or legal-svc synchronously, which would make issuing an invoice fail
 * whenever HR is down.
 */
@Injectable()
export class HrConsumer implements OnModuleInit {
  private readonly log = new Logger(HrConsumer.name);

  constructor(private readonly bus: EventBusService) {}

  async onModuleInit(): Promise<void> {
    this.bus.on('hr.employee.offboarded', async (raw, envelope) => {
      const payload = parseEventPayload('hr.employee.offboarded', raw);
      // Handlers must be idempotent — delivery is at-least-once, so this exact
      // event will occasionally arrive twice. Dedupe on envelope.id when the
      // action is not naturally idempotent.
      this.log.log(
        `Colaborador ${payload.employeeId} desligado em ${payload.lastDay} ` +
          `(evento ${envelope.id}). Encerrando cobranças recorrentes vinculadas.`,
      );
      // TODO(financial): cancelar agendamentos recorrentes do colaborador.
    });

    this.bus.on('legal.contract.activated', async (raw) => {
      const payload = parseEventPayload('legal.contract.activated', raw);
      this.log.log(
        `Contrato ${payload.reference} ativo desde ${payload.effectiveFrom}. ` +
          'Habilitando faturamento para a contraparte.',
      );
      // TODO(financial): criar cronograma de faturamento a partir do contrato.
    });

    await this.bus.startConsumer([...(SERVICE_BINDINGS['financial-svc'] ?? [])]);
  }
}
