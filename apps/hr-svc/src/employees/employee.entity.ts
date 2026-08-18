import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { EmploymentStatus } from '@ssm/contracts';

/**
 * Columns marked PII below are the ones the data-classification policy covers:
 * they are excluded from the default projection, redacted in logs, and are what
 * the anonymisation job clears when a retention period expires.
 * See docs/security/data-classification.md.
 */
@Entity({ name: 'employees' })
@Index('employees_tenant_status_idx', ['tenantId', 'status'])
@Index('employees_tenant_number_uq', ['tenantId', 'employeeNumber'], { unique: true })
@Index('employees_tenant_email_uq', ['tenantId', 'workEmail'], { unique: true })
export class EmployeeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** Never reused, even after the person leaves — payroll history refers to it. */
  @Column({ name: 'employee_number', type: 'varchar', length: 32 })
  employeeNumber!: string;

  /** Set when the person also has a login in identity-svc. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName!: string;

  @Column({ name: 'work_email', type: 'varchar', length: 320 })
  workEmail!: string;

  // --- PII -----------------------------------------------------------------
  @Column({ name: 'personal_email', type: 'varchar', length: 320, nullable: true })
  personalEmail!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone!: string | null;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth!: string | null;

  /**
   * Stored encrypted at rest by pgcrypto, not in plaintext: a national id is
   * the single most damaging field in this table if a backup leaks, and it is
   * read rarely enough that the decryption cost does not matter.
   */
  @Column({ name: 'national_id_enc', type: 'bytea', nullable: true })
  nationalIdEnc!: Buffer | null;

  @Column({ type: 'jsonb', nullable: true })
  address!: Record<string, unknown> | null;
  // --- end PII --------------------------------------------------------------

  @Column({ type: 'varchar', length: 24, default: 'onboarding' })
  status!: EmploymentStatus;

  @Column({ name: 'contract_type', type: 'varchar', length: 24 })
  contractType!: string;

  @Column({ name: 'job_title', type: 'varchar', length: 200 })
  jobTitle!: string;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId!: string | null;

  @Column({ name: 'manager_id', type: 'uuid', nullable: true })
  managerId!: string | null;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  /** Annual gross in minor units. Requires hr:payroll:read to read back. */
  @Column({ name: 'salary_minor', type: 'bigint', nullable: true, transformer: {
    to: (v: number | null) => v,
    from: (v: string | null) => (v === null ? null : Number(v)),
  } })
  salaryMinor!: number | null;

  @Column({ name: 'salary_currency', type: 'char', length: 3, nullable: true })
  salaryCurrency!: string | null;

  @Column({ name: 'document_key', type: 'text', nullable: true })
  documentKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
