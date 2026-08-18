import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import {
  RABBIT_TOPOLOGY,
  eventEnvelopeSchema,
  type EventEnvelope,
  type EventPayload,
  type EventType,
} from '@ssm/contracts';
import * as amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/app-config.js';
import { correlationId, currentContext, runWithContext } from '../http/correlation.middleware.js';
import { SecretsService } from '../secrets/secrets.service.js';

export type EventHandler<T extends EventType = EventType> = (
  payload: EventPayload<T>,
  envelope: EventEnvelope,
) => Promise<void> | void;

/**
 * Thin RabbitMQ client over amqplib.
 *
 * Chosen over @nestjs/microservices because SSM needs a topic exchange with a
 * dead-letter ring and per-message retry counting, which the Nest RMQ transport
 * does not model — it assumes one queue per pattern.
 *
 * Delivery is at-least-once. Handlers MUST be idempotent; the envelope `id` is
 * there so they can dedupe.
 */
@Injectable()
export class EventBusService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(EventBusService.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.ConfirmChannel;
  private readonly handlers = new Map<string, EventHandler[]>();
  private reconnectTimer?: NodeJS.Timeout;
  private closing = false;

  constructor(
    private readonly cfg: AppConfig,
    private readonly secrets: SecretsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    // Close the channel first so in-flight acks land before the socket goes.
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  private url(): string {
    const pass = encodeURIComponent(this.secrets.require('rabbitmq_password'));
    const user = encodeURIComponent(this.cfg.RABBITMQ_USER);
    const vhost = encodeURIComponent(this.cfg.RABBITMQ_VHOST);
    return `amqp://${user}:${pass}@${this.cfg.RABBITMQ_HOST}:${this.cfg.RABBITMQ_PORT}/${vhost}`;
  }

  private async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.url(), { heartbeat: 15 });
      this.connection.on('error', (e) => this.log.error(`AMQP connection error: ${e.message}`));
      this.connection.on('close', () => this.scheduleReconnect());

      this.channel = await this.connection.createConfirmChannel();
      // One unacked message at a time per consumer keeps ordering predictable
      // and stops a slow handler from hoarding the queue.
      await this.channel.prefetch(10);

      await this.assertTopology();
      await this.resubscribe();
      this.log.log(`Connected to RabbitMQ at ${this.cfg.RABBITMQ_HOST}`);
    } catch (err) {
      this.log.error(`RabbitMQ connect failed: ${(err as Error).message}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, 5_000);
  }

  /**
   * Every service asserts the identical topology, so the broker converges no
   * matter which one starts first and a fresh cluster needs no provisioning step.
   */
  private async assertTopology(): Promise<void> {
    const ch = this.channel!;
    const t = RABBIT_TOPOLOGY;

    await ch.assertExchange(t.exchange, t.exchangeType, { durable: true });
    await ch.assertExchange(t.deadLetterExchange, 'fanout', { durable: true });
    await ch.assertExchange(t.retryExchange, 'fanout', { durable: true });

    await ch.assertQueue(t.deadLetterQueue, { durable: true });
    await ch.bindQueue(t.deadLetterQueue, t.deadLetterExchange, '');

    // Messages parked here expire after retryDelayMs and are dead-lettered back
    // onto the main exchange — a delay without a broker plugin.
    await ch.assertQueue(t.retryQueue, {
      durable: true,
      messageTtl: t.retryDelayMs,
      deadLetterExchange: t.exchange,
    });
    await ch.bindQueue(t.retryQueue, t.retryExchange, '');
  }

  private async resubscribe(): Promise<void> {
    if (!this.handlers.size) return;
    await this.startConsumer([...this.handlers.keys()]);
  }

  // --- publishing ----------------------------------------------------------

  /**
   * Publishes a domain event. Waits for the broker's publisher confirm, so a
   * resolved promise means RabbitMQ has the message durably — not merely that
   * it was written to a socket.
   */
  async publish<T extends EventType>(
    type: T,
    data: EventPayload<T>,
    opts: { tenantId: string; actorId?: string | null; causationId?: string } = {
      tenantId: '',
    },
  ): Promise<string> {
    const ctx = currentContext();
    const envelope: EventEnvelope = {
      id: randomUUID(),
      type,
      version: 1,
      source: this.cfg.SERVICE_NAME,
      occurredAt: new Date().toISOString(),
      tenantId: opts.tenantId || ctx?.tenantId || '',
      correlationId: correlationId(),
      causationId: opts.causationId,
      actorId: opts.actorId ?? ctx?.actorId ?? null,
      data: data as Record<string, unknown>,
    };

    // Validate before publishing: a malformed event poisons every consumer, and
    // failing here means it never leaves the service that got it wrong.
    eventEnvelopeSchema.parse(envelope);

    if (!this.channel) throw new Error('Event bus is not connected');
    const body = Buffer.from(JSON.stringify(envelope));

    await new Promise<void>((res, rej) => {
      this.channel!.publish(RABBIT_TOPOLOGY.exchange, type, body, {
        persistent: true,
        contentType: 'application/json',
        messageId: envelope.id,
        correlationId: envelope.correlationId,
        timestamp: Date.now(),
        type,
        appId: this.cfg.SERVICE_NAME,
        headers: { 'x-tenant-id': envelope.tenantId, 'x-event-version': envelope.version },
      }, (err) => (err ? rej(err) : res()));
    });

    this.log.debug(`Published ${type} (${envelope.id})`);
    return envelope.id;
  }

  // --- consuming -----------------------------------------------------------

  /** Registers a handler. Call during module init; consumption starts on connect. */
  on<T extends EventType>(pattern: T | string, handler: EventHandler<T>): void {
    const list = this.handlers.get(pattern) ?? [];
    list.push(handler as EventHandler);
    this.handlers.set(pattern, list);
  }

  async startConsumer(patterns: string[]): Promise<void> {
    if (!this.channel) return;
    const queue = RABBIT_TOPOLOGY.queueFor(this.cfg.SERVICE_NAME);

    await this.channel.assertQueue(queue, {
      durable: true,
      deadLetterExchange: RABBIT_TOPOLOGY.deadLetterExchange,
    });
    for (const p of patterns) {
      await this.channel.bindQueue(queue, RABBIT_TOPOLOGY.exchange, p);
    }

    await this.channel.consume(queue, (msg) => void this.handleMessage(msg), { noAck: false });
    this.log.log(`Consuming ${queue} bound to [${patterns.join(', ')}]`);
  }

  private async handleMessage(msg: amqp.ConsumeMessage | null): Promise<void> {
    if (!msg || !this.channel) return;
    const ch = this.channel;

    let envelope: EventEnvelope;
    try {
      envelope = eventEnvelopeSchema.parse(JSON.parse(msg.content.toString('utf8')));
    } catch (err) {
      // Unparseable: retrying cannot help, so send it straight to the DLQ.
      this.log.error(`Malformed message discarded: ${(err as Error).message}`);
      ch.nack(msg, false, false);
      return;
    }

    const matching = [...this.handlers.entries()]
      .filter(([pattern]) => matches(pattern, envelope.type))
      .flatMap(([, hs]) => hs);

    if (!matching.length) {
      ch.ack(msg);
      return;
    }

    // Consumers get the same correlation id the producer had, so a chain of
    // events reads as one trace.
    await runWithContext(
      {
        correlationId: envelope.correlationId,
        tenantId: envelope.tenantId,
        actorId: envelope.actorId ?? undefined,
      },
      async () => {
        try {
          for (const h of matching) await h(envelope.data as never, envelope);
          ch.ack(msg);
        } catch (err) {
          const attempts = Number(msg.properties.headers?.['x-attempts'] ?? 0) + 1;
          this.log.error(
            `Handler failed for ${envelope.type} (${envelope.id}), attempt ${attempts}: ` +
              `${(err as Error).message}`,
          );

          if (attempts >= RABBIT_TOPOLOGY.maxDeliveryAttempts) {
            ch.nack(msg, false, false); // -> DLQ
          } else {
            // Park on the retry queue; its TTL bounces it back to the main exchange.
            ch.publish(RABBIT_TOPOLOGY.retryExchange, envelope.type, msg.content, {
              ...msg.properties,
              headers: { ...msg.properties.headers, 'x-attempts': attempts },
            });
            ch.ack(msg);
          }
        }
      },
    );
  }

  isHealthy(): boolean {
    return this.connection !== undefined && this.channel !== undefined;
  }
}

/** AMQP topic matching: `*` is one word, `#` is zero or more. */
function matches(pattern: string, routingKey: string): boolean {
  if (pattern === routingKey) return true;
  const rx = new RegExp(
    '^' +
      pattern
        .split('.')
        .map((seg) => (seg === '*' ? '[^.]+' : seg === '#' ? '.*' : escapeRe(seg)))
        .join('\\.') +
      '$',
  );
  return rx.test(routingKey);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
