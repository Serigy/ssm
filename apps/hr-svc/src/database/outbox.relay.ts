import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { EventBusService, runWithContext } from '@ssm/nest-common';
import type { EventType } from '@ssm/contracts';
import { DataSource } from 'typeorm';

/**
 * Raw row shape returned by the SELECT below.
 *
 * Deliberately NOT OutboxEntity: `tx.query` bypasses TypeORM's column mapping
 * and hands back the database's snake_case names. Typing it as the entity
 * compiles but every property read is undefined at runtime — which is the kind
 * of bug that publishes events with an empty tenantId and is only noticed
 * downstream.
 */
interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  type: string;
  payload: Record<string, unknown>;
  tenant_id: string;
  actor_id: string | null;
  correlation_id: string;
  created_at: Date;
  published_at: Date | null;
  attempts: number;
  last_error: string | null;
}

/**
 * Publishes committed outbox rows to RabbitMQ.
 *
 * Runs in every replica. `FOR UPDATE SKIP LOCKED` is what makes that safe:
 * each replica claims a disjoint batch, so three pods drain the table three
 * times as fast instead of fighting over the same rows or double-publishing.
 *
 * Polling rather than LISTEN/NOTIFY because NOTIFY is lost if no connection is
 * listening at that instant — which is precisely the crash window the outbox
 * exists to survive.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  private readonly intervalMs = 1_000;
  private readonly batchSize = 50;
  private readonly maxAttempts = 10;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly bus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.drain(), this.intervalMs);
    this.log.log(`Outbox relay started (every ${this.intervalMs}ms, batch ${this.batchSize}).`);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearInterval(this.timer);
  }

  async drain(): Promise<void> {
    // One pass at a time per replica; a slow broker must not stack up timers.
    if (this.running || this.stopped || !this.bus.isHealthy()) return;
    this.running = true;

    try {
      await this.db.transaction(async (tx) => {
        const rows: OutboxRow[] = await tx.query(
          `SELECT * FROM outbox
            WHERE published_at IS NULL AND attempts < $1
            ORDER BY created_at
            LIMIT $2
            FOR UPDATE SKIP LOCKED`,
          [this.maxAttempts, this.batchSize],
        );

        if (!rows.length) return;

        for (const row of rows) {
          // Rehydrate the producer's correlation id so the published event
          // continues the trace of the request that caused it, not the relay's.
          await runWithContext(
            {
              correlationId: row.correlation_id,
              tenantId: row.tenant_id,
              actorId: row.actor_id ?? undefined,
            },
            async () => {
              try {
                await this.bus.publish(
                  (row.type as EventType),
                  row.payload as never,
                  {
                    tenantId: row.tenant_id,
                    actorId: row.actor_id,
                  },
                );
                await tx.query(`UPDATE outbox SET published_at = now() WHERE id = $1`, [row.id]);
              } catch (err) {
                const message = (err as Error).message.slice(0, 500);
                await tx.query(
                  `UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
                  [row.id, message],
                );
                this.log.error(`Falha ao publicar ${row.type} (${row.id}): ${message}`);
              }
            },
          );
        }

        this.log.debug(`Outbox: ${rows.length} evento(s) processado(s).`);
      });
    } catch (err) {
      this.log.error(`Outbox relay error: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
