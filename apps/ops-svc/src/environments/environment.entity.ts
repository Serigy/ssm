import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { EnvironmentKind, EnvironmentStatus, MaintenanceWindow } from '@ssm/contracts';

@Entity({ name: 'environments' })
@Index('environments_tenant_status_idx', ['tenantId', 'status'])
@Index('environments_tenant_code_uq', ['tenantId', 'code'], { unique: true })
export class EnvironmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** "amb-prod-02" — how operators refer to it in a call at three in the morning. */
  @Column({ type: 'varchar', length: 40 })
  code!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 24 })
  kind!: EnvironmentKind;

  @Column({ type: 'varchar', length: 24, default: 'operational' })
  status!: EnvironmentStatus;

  @Column({ type: 'varchar', length: 60, nullable: true })
  region!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  provider!: string | null;

  /**
   * Reference to the legal contract, not a foreign key — that record lives in
   * MongoDB under legal-svc. Reconciled by consuming legal's events rather than
   * enforced by the database; see docs/adr/0004-postgres-e-mongodb.md.
   */
  @Column({ name: 'contract_ref', type: 'varchar', length: 64, nullable: true })
  contractRef!: string | null;

  /** Basis points: 9950 == 99,50%. Integer, so it matches the contract exactly. */
  @Column({ name: 'availability_target_bps', type: 'int', default: 9950 })
  availabilityTargetBps!: number;

  @Column({ name: 'response_sev1_minutes', type: 'int', default: 15 })
  responseSev1Minutes!: number;

  @Column({ name: 'response_sev2_minutes', type: 'int', default: 60 })
  responseSev2Minutes!: number;

  @Column({ name: 'response_sev3_minutes', type: 'int', default: 480 })
  responseSev3Minutes!: number;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags!: string[];

  /**
   * Planned maintenance. Downtime inside this window does not count against
   * availability, which is the whole reason it is recorded up front rather
   * than argued about after the fact.
   */
  @Column({ name: 'next_window', type: 'jsonb', nullable: true })
  nextWindow!: MaintenanceWindow | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
