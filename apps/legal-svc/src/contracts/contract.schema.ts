import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { ContractStatus } from '@ssm/contracts';

/**
 * Mongo, not Postgres, for exactly one reason: a contract is a tree of clauses
 * of unbounded depth, and every amendment produces a new full version of that
 * tree. Modelling that relationally means either a recursive CTE over an
 * adjacency table on every read, or a JSONB column that gives up referential
 * integrity anyway. Since the clause tree has no foreign keys *into* it from
 * elsewhere, there is nothing to protect and nothing to gain.
 *
 * Everything that DOES need referential integrity — who the counterparty is,
 * what it is billed — lives in Postgres under financial-svc, referenced here by
 * id only. See docs/adr/0004-postgres-e-mongodb.md.
 */

@Schema({ _id: false })
export class Clause {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  ordinal!: string;

  @Prop({ required: true })
  heading!: string;

  @Prop({ required: true })
  body!: string;

  @Prop({ type: String, default: null })
  risk!: string | null;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  /**
   * Declared as Mixed because the type is recursive and Mongoose cannot express
   * that directly. The Zod schema in @ssm/contracts is what actually validates
   * the shape, on the way in.
   */
  @Prop({ type: [Object], default: [] })
  children!: Clause[];
}
export const ClauseSchema = SchemaFactory.createForClass(Clause);

@Schema({ _id: false })
export class Party {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  role!: string;

  @Prop({ type: String, default: null })
  externalRef!: string | null;
}
export const PartySchema = SchemaFactory.createForClass(Party);

@Schema({ _id: false })
export class Obligation {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  clauseId!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({ required: true, enum: ['us', 'counterparty'] })
  owner!: string;

  @Prop({ type: String, default: null })
  dueDate!: string | null;

  @Prop({ default: 'once' })
  recurrence!: string;

  @Prop({ type: Object, default: null })
  amount!: { amountMinor: number; currency: string } | null;

  @Prop({ default: false })
  fulfilled!: boolean;
}
export const ObligationSchema = SchemaFactory.createForClass(Obligation);

@Schema({ _id: false })
export class ContractVersion {
  @Prop({ required: true })
  version!: number;

  @Prop({ required: true })
  createdAt!: Date;

  @Prop({ type: String, default: null })
  createdBy!: string | null;

  @Prop()
  note?: string;

  @Prop({ type: String, default: null })
  documentKey!: string | null;

  @Prop({ type: [Object], default: [] })
  clauses!: Clause[];
}
export const ContractVersionSchema = SchemaFactory.createForClass(ContractVersion);

@Schema({ collection: 'contracts', timestamps: true, versionKey: false })
export class Contract {
  _id!: Types.ObjectId;

  /** Application-generated UUID; the ObjectId never leaves this service. */
  @Prop({ required: true, index: true })
  id!: string;

  @Prop({ required: true, index: true })
  tenantId!: string;

  @Prop({ required: true })
  reference!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  kind!: string;

  @Prop({ required: true, default: 'draft' })
  status!: ContractStatus;

  @Prop({ type: [PartySchema], default: [] })
  parties!: Party[];

  @Prop({ type: String, default: null })
  governingLaw!: string | null;

  @Prop({ type: String, default: null })
  jurisdiction!: string | null;

  @Prop({ type: String, default: null })
  effectiveFrom!: string | null;

  @Prop({ type: String, default: null })
  effectiveTo!: string | null;

  @Prop({ default: 30 })
  renewalNoticeDays!: number;

  @Prop({ default: false })
  autoRenew!: boolean;

  @Prop({ type: Object, default: null })
  value!: { amountMinor: number; currency: string } | null;

  @Prop({ type: String, default: null })
  risk!: string | null;

  @Prop({ type: [String], default: [], index: true })
  tags!: string[];

  @Prop({ default: 1 })
  currentVersion!: number;

  @Prop({ type: [Object], default: [] })
  clauses!: Clause[];

  @Prop({ type: [ObligationSchema], default: [] })
  obligations!: Obligation[];

  /**
   * Full snapshot per amendment. Storage is cheap; reconstructing "what did
   * clause 7.3 say when this was signed" from a diff chain is not.
   */
  @Prop({ type: [ContractVersionSchema], default: [] })
  versions!: ContractVersion[];

  @Prop({ type: String, default: null })
  documentKey!: string | null;

  /**
   * Guard for the expiry notice. Holds the effectiveTo the last notice was sent
   * for, so a conditional update lets exactly one replica publish per version
   * of the end date — and a renewal that moves the date re-arms it automatically.
   */
  @Prop({ type: String, default: null })
  expiryNoticeSentFor!: string | null;

  @Prop({ type: String, default: null })
  createdBy!: string | null;

  @Prop({ type: String, default: null })
  updatedBy!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ContractDocument = HydratedDocument<Contract>;
export const ContractSchema = SchemaFactory.createForClass(Contract);

// Tenant leads every index, for the same reason it leads every Postgres index:
// isolation must be cheap or it will be skipped.
ContractSchema.index({ tenantId: 1, id: 1 }, { unique: true });
ContractSchema.index({ tenantId: 1, reference: 1 }, { unique: true });
ContractSchema.index({ tenantId: 1, status: 1, effectiveTo: 1 });
// Drives the "expiring soon" report and the daily notice job.
ContractSchema.index({ tenantId: 1, effectiveTo: 1 }, { sparse: true });
// Free-text search over the fields a lawyer actually searches by.
ContractSchema.index(
  { title: 'text', reference: 'text', 'parties.name': 'text' },
  { name: 'contracts_text_idx', weights: { reference: 10, title: 5, 'parties.name': 1 } },
);
