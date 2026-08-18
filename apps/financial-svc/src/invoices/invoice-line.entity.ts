import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { InvoiceEntity } from './invoice.entity.js';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

@Entity({ name: 'invoice_lines' })
export class InvoiceLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => InvoiceEntity, (invoice) => invoice.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice!: InvoiceEntity;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId!: string;

  /** Preserves the order the user entered; without it list order is arbitrary. */
  @Column({ type: 'int' })
  position!: number;

  @Column({ type: 'varchar', length: 500 })
  description!: string;

  /** Thousandths, so 1.5 units is 1500 and all arithmetic stays integral. */
  @Column({ name: 'quantity_milli', type: 'bigint', transformer: bigintToNumber })
  quantityMilli!: number;

  @Column({ name: 'unit_price_minor', type: 'bigint', transformer: bigintToNumber })
  unitPriceMinor!: number;

  /** Basis points: 2100 == 21%. Integer, so a rate never rounds. */
  @Column({ name: 'tax_rate_bps', type: 'int', default: 0 })
  taxRateBps!: number;

  @Column({ name: 'line_total_minor', type: 'bigint', transformer: bigintToNumber })
  lineTotalMinor!: number;
}
