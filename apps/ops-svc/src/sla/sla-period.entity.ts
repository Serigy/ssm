import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const bigintToNumber = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

/**
 * One reckoning per environment per month. Immutable once written: it is the
 * basis of a credit on a customer's invoice, so recomputing it silently would
 * change a figure someone already saw.
 */
@Entity({ name: 'sla_periods' })
@Index('sla_periods_unique', ['tenantId', 'environmentId', 'month'], { unique: true })
export class SlaPeriodEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'environment_id', type: 'uuid' })
  environmentId!: string;

  @Column({ name: 'environment_code', type: 'varchar', length: 40 })
  environmentCode!: string;

  /** First day of the month, so the unique index has something to key on. */
  @Column({ type: 'date' })
  month!: string;

  @Column({ name: 'measured_minutes', type: 'int' })
  measuredMinutes!: number;

  @Column({ name: 'downtime_minutes', type: 'int' })
  downtimeMinutes!: number;

  @Column({ name: 'achieved_bps', type: 'int' })
  achievedBps!: number;

  /** Copied at reckoning time — the target then, not the target now. */
  @Column({ name: 'target_bps', type: 'int' })
  targetBps!: number;

  @Column({ type: 'boolean', default: false })
  breached!: boolean;

  @Column({ name: 'credit_minor', type: 'bigint', nullable: true, transformer: bigintToNumber })
  creditMinor!: number | null;

  @Column({ name: 'credit_currency', type: 'char', length: 3, nullable: true })
  creditCurrency!: string | null;

  @Column({ name: 'reckoned_at', type: 'timestamptz', default: () => 'now()' })
  reckonedAt!: Date;
}
