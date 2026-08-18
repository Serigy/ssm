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

    /**
     * The SLA credit. This is the event that closes the loop across the whole
     * system: legal wrote the availability commitment, operations measured the
     * month against it, and financial owes the customer money for the gap.
     *
     * The amount arrives already computed, by the shared computeSlaCredit in
     * @ssm/contracts — recomputing it here would be a second implementation of
     * a figure that appears on an invoice, which is the disagreement this
     * architecture goes out of its way to avoid.
     */
    this.bus.on('operations.sla.breached', async (raw, envelope) => {
      const p = parseEventPayload('operations.sla.breached', raw);
      this.log.warn(
        `SLA descumprido em ${p.environmentCode} no mês ${p.month}: ` +
          `${(p.achievedBps / 100).toFixed(2)}% contra meta de ${(p.targetBps / 100).toFixed(2)}% ` +
          `(${p.downtimeMinutes} min indisponível). Crédito de ` +
          `${p.credit.amountMinor} ${p.credit.currency} a lançar` +
          `${p.contractRef ? ` no contrato ${p.contractRef}` : ''} (evento ${envelope.id}).`,
      );
      // TODO(financial): emitir nota de crédito e abatê-la da próxima fatura da
      // contraparte. Depende das notas de crédito, ainda pendentes — ver
      // docs/modules/financeiro.md.
    });

    await this.bus.startConsumer([...(SERVICE_BINDINGS['financial-svc'] ?? [])]);
  }
}
