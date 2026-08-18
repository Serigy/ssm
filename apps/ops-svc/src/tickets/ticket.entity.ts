import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Severity, TicketEvent, TicketStatus } from '@ssm/contracts';

@Entity({ name: 'tickets' })
@Index('tickets_tenant_status_idx', ['tenantId', 'status', 'severity'])
@Index('tickets_tenant_number_uq', ['tenantId', 'number'], { unique: true })
@Index('tickets_environment_idx', ['environmentId'])
export class TicketEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** Sequential per tenant. Shown as "#4809" and never reused. */
  @Column({ type: 'int' })
  number!: number;

  @Column({ type: 'varchar', length: 300 })
  subject!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ type: 'varchar', length: 16, default: 'incident' })
  kind!: string;

  @Column({ type: 'varchar', length: 8 })
  severity!: Severity;

  @Column({ type: 'varchar', length: 24, default: 'open' })
  status!: TicketStatus;

  @Column({ name: 'environment_id', type: 'uuid', nullable: true })
  environmentId!: string | null;

  /**
   * Denormalised on purpose. A ticket list shows the environment code on every
   * row, and joining for it turns the busiest screen in the module into a join
   * per page. The code is immutable in practice — renaming an environment
   * mid-incident is not a thing that happens.
   */
  @Column({ name: 'environment_code', type: 'varchar', length: 40, nullable: true })
  environmentCode!: string | null;

  /** HR employee. A reference across module boundaries, so no foreign key. */
  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId!: string | null;

  @Column({ name: 'opened_at', type: 'timestamptz' })
  openedAt!: Date;

  @Column({ name: 'first_response_at', type: 'timestamptz', nullable: true })
  firstResponseAt!: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  /** Computed at opening from the environment's target for this severity. */
  @Column({ name: 'response_due_at', type: 'timestamptz' })
  responseDueAt!: Date;

  /**
   * Stored, not derived. The environment's response target can be renegotiated,
   * and what counts for a past month is the commitment that was in force then.
   */
  @Column({ name: 'response_breached', type: 'boolean', default: false })
  responseBreached!: boolean;

  /** Minutes spent waiting on the customer, excluded from the resolution clock. */
  @Column({ name: 'paused_minutes', type: 'int', default: 0 })
  pausedMinutes!: number;

  @Column({ name: 'waiting_since', type: 'timestamptz', nullable: true })
  waitingSince!: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  timeline!: TicketEvent[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
