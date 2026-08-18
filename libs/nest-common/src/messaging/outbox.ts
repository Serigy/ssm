import type { EventPayload, EventType } from '@ssm/contracts';

/**
 * Transactional outbox.
 *
 * The problem it solves: a handler that writes a row and then publishes an
 * event has two commits and no transaction spanning them. Crash in between and
 * the database says the invoice was issued while nobody downstream ever heard.
 *
 * The fix: write the event into an `outbox` table *inside the same Postgres
 * transaction* as the domain change. A relay process then publishes rows and
 * marks them sent. The database commit is the single point of truth; the worst
 * case is a duplicate publish, which consumers already tolerate because
 * delivery is at-least-once anyway.
 *
 * Services on MongoDB (legal-svc) use the same table shape in a collection and
 * the same relay contract.
 */
export interface OutboxRecord {
  id: string;
  aggregateType: string;
  aggregateId: string;
  type: EventType;
  payload: Record<string, unknown>;
  tenantId: string;
  actorId: string | null;
  correlationId: string;
  createdAt: Date;
  publishedAt: Date | null;
  attempts: number;
  lastError: string | null;
}

export interface OutboxWriter {
  /**
   * Enqueue an event. MUST be called with the same transaction/session handle
   * as the domain write — that is the whole point.
   */
  enqueue<T extends EventType>(
    tx: unknown,
    type: T,
    payload: EventPayload<T>,
    meta: { aggregateType: string; aggregateId: string; tenantId: string; actorId?: string | null },
  ): Promise<void>;
}

export const OUTBOX_TABLE = 'outbox';

/** DDL shared by every Postgres-backed service; applied by its first migration. */
export const OUTBOX_DDL = `
CREATE TABLE IF NOT EXISTS ${OUTBOX_TABLE} (
  id              uuid PRIMARY KEY,
  aggregate_type  text        NOT NULL,
  aggregate_id    uuid        NOT NULL,
  type            text        NOT NULL,
  payload         jsonb       NOT NULL,
  tenant_id       uuid        NOT NULL,
  actor_id        uuid,
  correlation_id  uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  attempts        int         NOT NULL DEFAULT 0,
  last_error      text
);

-- The relay's only query: unpublished rows, oldest first. Partial index keeps
-- it small no matter how large the table grows.
CREATE INDEX IF NOT EXISTS ${OUTBOX_TABLE}_unpublished_idx
  ON ${OUTBOX_TABLE} (created_at)
  WHERE published_at IS NULL;
`;
