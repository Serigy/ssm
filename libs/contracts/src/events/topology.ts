/**
 * RabbitMQ topology. Declared once here and asserted identically by every
 * service at boot, so the broker converges no matter which service starts first.
 */
export const RABBIT_TOPOLOGY = {
  /** Single topic exchange for all domain events. */
  exchange: 'ssm.events',
  exchangeType: 'topic' as const,

  /** Where messages go after retries are exhausted. */
  deadLetterExchange: 'ssm.events.dlx',
  deadLetterQueue: 'ssm.events.dlq',

  /** Delayed-retry ring: a message rejected N times lands here, then re-queues. */
  retryExchange: 'ssm.events.retry',
  retryQueue: 'ssm.events.retry.q',
  retryDelayMs: 10_000,
  maxDeliveryAttempts: 5,

  /** Per-service queue name. Durable, one queue per consuming service. */
  queueFor: (service: string) => `ssm.${service}.q`,
} as const;

/** Bindings each service declares. Keep in sync with the consumers it registers. */
export const SERVICE_BINDINGS: Record<string, readonly string[]> = {
  'financial-svc': ['hr.employee.*', 'legal.contract.activated'],
  'hr-svc': ['financial.payroll.*'],
  'legal-svc': ['financial.invoice.issued', 'hr.employee.offboarded'],
  'identity-svc': ['#'],
  gateway: [],
};
