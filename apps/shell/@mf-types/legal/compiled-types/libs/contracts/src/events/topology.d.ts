/**
 * RabbitMQ topology. Declared once here and asserted identically by every
 * service at boot, so the broker converges no matter which service starts first.
 */
export declare const RABBIT_TOPOLOGY: {
    /** Single topic exchange for all domain events. */
    readonly exchange: "ssm.events";
    readonly exchangeType: "topic";
    /** Where messages go after retries are exhausted. */
    readonly deadLetterExchange: "ssm.events.dlx";
    readonly deadLetterQueue: "ssm.events.dlq";
    /** Delayed-retry ring: a message rejected N times lands here, then re-queues. */
    readonly retryExchange: "ssm.events.retry";
    readonly retryQueue: "ssm.events.retry.q";
    readonly retryDelayMs: 10000;
    readonly maxDeliveryAttempts: 5;
    /** Per-service queue name. Durable, one queue per consuming service. */
    readonly queueFor: (service: string) => string;
};
/** Bindings each service declares. Keep in sync with the consumers it registers. */
export declare const SERVICE_BINDINGS: Record<string, readonly string[]>;
//# sourceMappingURL=topology.d.ts.map