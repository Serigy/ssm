import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventBusService, runWithContext } from '@ssm/nest-common';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Contract, type ContractDocument } from './contract.schema.js';

/**
 * Emits `legal.contract.expiring` once per contract entering its notice window.
 *
 * Two things make this safe to run in every replica:
 *   - the guard field `expiryNoticeSentFor`, updated with a conditional write,
 *     so exactly one replica wins and the notice fires once per version;
 *   - it is idempotent by date, so a restart mid-run cannot double-notify.
 *
 * A CronJob would also work, but keeping it in-process means the notice window
 * logic lives next to the query that defines it.
 */
@Injectable()
export class ExpiryScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(ExpiryScheduler.name);
  private timer?: NodeJS.Timeout;
  private readonly intervalMs = 60 * 60 * 1000; // hourly

  constructor(
    @InjectModel(Contract.name) private readonly model: Model<ContractDocument>,
    private readonly bus: EventBusService,
  ) {}

  onModuleInit(): void {
    // Delay the first pass so a rolling deploy does not have every replica
    // scanning at the same instant.
    this.timer = setInterval(() => void this.scan(), this.intervalMs);
    setTimeout(() => void this.scan(), 30_000);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async scan(): Promise<void> {
    if (!this.bus.isHealthy()) return;

    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);

    try {
      const candidates = await this.model
        .find({ status: 'active', effectiveTo: { $ne: null, $gte: todayIso } })
        .select('id tenantId reference effectiveTo renewalNoticeDays expiryNoticeSentFor')
        .lean()
        .exec();

      for (const c of candidates) {
        const expiresOn = new Date(c.effectiveTo as string);
        const daysRemaining = Math.ceil((expiresOn.getTime() - today.getTime()) / 86_400_000);
        if (daysRemaining > (c.renewalNoticeDays ?? 30)) continue;

        // Conditional update: only the replica whose write matches gets to publish.
        const claimed = await this.model.updateOne(
          { id: c.id, tenantId: c.tenantId, expiryNoticeSentFor: { $ne: c.effectiveTo } },
          { $set: { expiryNoticeSentFor: c.effectiveTo } },
        );
        if (claimed.modifiedCount !== 1) continue;

        await runWithContext(
          { correlationId: randomUUID(), tenantId: c.tenantId as string },
          async () => {
            await this.bus.publish(
              'legal.contract.expiring',
              {
                contractId: c.id as string,
                reference: c.reference as string,
                expiresOn: c.effectiveTo as string,
                daysRemaining,
              },
              { tenantId: c.tenantId as string },
            );
          },
        );

        this.log.log(`Aviso de vencimento emitido para ${c.reference} (${daysRemaining} dias).`);
      }
    } catch (err) {
      this.log.error(`Falha na varredura de vencimentos: ${(err as Error).message}`);
    }
  }
}
