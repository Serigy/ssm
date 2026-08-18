import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Transactional outbox row. Written in the same transaction as the domain
 * change; published afterwards by the relay. See libs/nest-common outbox.ts
 * for why this exists rather than publishing inline.
 */
@Entity({ name: 'outbox' })
@Index('outbox_unpublished_idx', ['createdAt'], { where: '"published_at" IS NULL' })
export class OutboxEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'aggregate_type', type: 'text' })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ name: 'correlation_id', type: 'uuid' })
  correlationId!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;
}
