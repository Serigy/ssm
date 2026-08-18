import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { InvoiceStatus } from '@ssm/contracts';
import { InvoiceLineEntity } from './invoice-line.entity.js';

/**
 * Money is stored as (bigint minor units, char(3) currency) — never numeric or
 * float. `bigint` comes back from pg as a string, which is why the column has
 * an explicit transformer: silently losing precision above 2^53 in a financial
 * ledger is exactly the bug this table shape exists to prevent.
 */
const bigintToNumber = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

@Entity({ name: 'invoices' })
// Every list query filters by tenant first; leading the index with it is what
// makes cross-tenant isolation cheap rather than a full scan per request.
@Index('invoices_tenant_status_idx', ['tenantId', 'status', 'dueDate'])
@Index('invoices_tenant_number_uq', ['tenantId', 'number'], {
  unique: true,
  where: '"number" IS NOT NULL',
})
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** Assigned at issue time, not at creation — a draft has no number. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  number!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'draft' })
  status!: InvoiceStatus;

  @Column({ name: 'counterparty_id', type: 'uuid' })
  counterpartyId!: string;

  @Column({ name: 'counterparty_name', type: 'varchar', length: 200 })
  counterpartyName!: string;

  @Column({ name: 'issue_date', type: 'date', nullable: true })
  issueDate!: string | null;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ name: 'subtotal_minor', type: 'bigint', default: 0, transformer: bigintToNumber })
  subtotalMinor!: number;

  @Column({ name: 'tax_total_minor', type: 'bigint', default: 0, transformer: bigintToNumber })
  taxTotalMinor!: number;

  @Column({ name: 'total_minor', type: 'bigint', default: 0, transformer: bigintToNumber })
  totalMinor!: number;

  @Column({ name: 'amount_paid_minor', type: 'bigint', default: 0, transformer: bigintToNumber })
  amountPaidMinor!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'document_key', type: 'text', nullable: true })
  documentKey!: string | null;

  /**
   * NOT eager. An eager relation forces a LEFT JOIN into every single query,
   * which breaks two things here:
   *
   *   - `SELECT ... FOR UPDATE` is rejected by Postgres with "FOR UPDATE cannot
   *     be applied to the nullable side of an outer join", so the row lock that
   *     protects concurrent payments could never be taken;
   *   - it collides with the explicit leftJoinAndSelect + take() in the list
   *     query, producing a join TypeORM then paginates incorrectly.
   *
   * Callers load lines explicitly: `relations: { lines: true }` for reads, and
   * a separate find() after the lock is taken for writes.
   */
  @OneToMany(() => InvoiceLineEntity, (line) => line.invoice, {
    cascade: ['insert', 'update'],
  })
  lines!: InvoiceLineEntity[];

  /**
   * Optimistic locking. Two users editing the same draft is normal; the second
   * save failing loudly with a 409 is far better than one silently winning.
   */
  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
