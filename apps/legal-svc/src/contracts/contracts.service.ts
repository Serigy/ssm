import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type Clause,
  type Contract as ContractDto,
  type ContractFilter,
  type ContractStatus,
  type CreateContract,
  type Page,
  type PageQuery,
  type UpdateContract,
} from '@ssm/contracts';
import { EventBusService, ObjectStorageService } from '@ssm/nest-common';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Contract, type ContractDocument } from './contract.schema.js';

const TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['in_review', 'terminated'],
  in_review: ['draft', 'awaiting_signature', 'terminated'],
  awaiting_signature: ['active', 'in_review', 'terminated'],
  active: ['expired', 'terminated'],
  expired: ['active'], // renewal reactivates
  terminated: [],
};

@Injectable()
export class ContractsService {
  private readonly log = new Logger(ContractsService.name);

  constructor(
    @InjectModel(Contract.name) private readonly model: Model<ContractDocument>,
    private readonly bus: EventBusService,
    private readonly storage: ObjectStorageService,
  ) {}

  async list(
    tenantId: string,
    filter: ContractFilter,
    page: PageQuery,
  ): Promise<Page<ContractDto>> {
    const query: Record<string, unknown> = { tenantId };

    if (filter.status) query.status = filter.status;
    if (filter.kind) query.kind = filter.kind;
    if (filter.risk) query.risk = filter.risk;
    if (filter.tag) query.tags = filter.tag;

    if (filter.expiringWithinDays) {
      const limit = new Date();
      limit.setDate(limit.getDate() + filter.expiringWithinDays);
      query.status = 'active';
      query.effectiveTo = {
        $ne: null,
        $lte: limit.toISOString().slice(0, 10),
        $gte: new Date().toISOString().slice(0, 10),
      };
    }

    if (filter.q) {
      // $text uses the weighted index; it will not match a substring inside a
      // word, which is the right trade for a legal corpus where whole-term
      // matching is what people mean.
      query.$text = { $search: filter.q };
    }

    if (page.cursor) {
      const { createdAt, id } = decodeCursor(page.cursor);
      query.$or = [
        { createdAt: { $lt: new Date(createdAt) } },
        { createdAt: new Date(createdAt), id: { $lt: id } },
      ];
    }

    const docs = await this.model
      .find(query)
      .sort({ createdAt: -1, id: -1 })
      .limit(page.limit + 1)
      // Version history is large and never needed in a list.
      .select('-versions')
      .lean()
      .exec();

    const hasMore = docs.length > page.limit;
    const items = hasMore ? docs.slice(0, page.limit) : docs;
    const last = items[items.length - 1];

    return {
      items: items.map((d) => toDto(d as unknown as Contract)),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt as Date, last.id as string) : null,
    };
  }

  async findOne(tenantId: string, id: string): Promise<ContractDto> {
    const doc = await this.model.findOne({ tenantId, id }).lean().exec();
    if (!doc) throw new NotFoundException(`Contrato ${id} não encontrado.`);
    return toDto(doc as unknown as Contract);
  }

  async create(tenantId: string, actorId: string, dto: CreateContract): Promise<ContractDto> {
    const id = randomUUID();
    const reference = await this.nextReference(tenantId, dto.kind);

    const doc = await this.model.create({
      id,
      tenantId,
      reference,
      title: dto.title,
      kind: dto.kind,
      status: 'draft',
      parties: dto.parties.map((p) => ({ ...p, id: randomUUID() })),
      governingLaw: dto.governingLaw ?? null,
      jurisdiction: dto.jurisdiction ?? null,
      effectiveFrom: dto.effectiveFrom ?? null,
      effectiveTo: dto.effectiveTo ?? null,
      renewalNoticeDays: dto.renewalNoticeDays ?? 30,
      autoRenew: dto.autoRenew ?? false,
      value: dto.value ?? null,
      risk: null,
      tags: dto.tags ?? [],
      currentVersion: 1,
      clauses: [],
      obligations: [],
      versions: [],
      documentKey: null,
      createdBy: actorId,
      updatedBy: actorId,
    });

    this.log.log(`Contrato ${reference} criado como rascunho.`);
    return toDto(doc.toObject() as Contract);
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateContract,
  ): Promise<ContractDto> {
    const doc = await this.model.findOne({ tenantId, id }).exec();
    if (!doc) throw new NotFoundException(`Contrato ${id} não encontrado.`);

    // Once signed, the text is the agreement. Changing it means an amendment,
    // which produces a new version — never an in-place edit.
    if (doc.status === 'active' || doc.status === 'terminated') {
      throw new ConflictException(
        `Um contrato "${doc.status}" não pode ser editado. Registre um aditivo com POST /:id/amend.`,
      );
    }

    Object.assign(doc, {
      title: dto.title ?? doc.title,
      governingLaw: dto.governingLaw ?? doc.governingLaw,
      jurisdiction: dto.jurisdiction ?? doc.jurisdiction,
      effectiveFrom: dto.effectiveFrom ?? doc.effectiveFrom,
      effectiveTo: dto.effectiveTo ?? doc.effectiveTo,
      renewalNoticeDays: dto.renewalNoticeDays ?? doc.renewalNoticeDays,
      autoRenew: dto.autoRenew ?? doc.autoRenew,
      value: dto.value ?? doc.value,
      tags: dto.tags ?? doc.tags,
      updatedBy: actorId,
    });

    await doc.save();
    return toDto(doc.toObject() as Contract);
  }

  /** Replaces the clause tree and snapshots the previous state as a version. */
  async amend(
    tenantId: string,
    actorId: string,
    id: string,
    clauses: Clause[],
    note?: string,
  ): Promise<ContractDto> {
    const doc = await this.model.findOne({ tenantId, id }).exec();
    if (!doc) throw new NotFoundException(`Contrato ${id} não encontrado.`);

    doc.versions.push({
      version: doc.currentVersion,
      createdAt: new Date(),
      createdBy: actorId,
      note,
      documentKey: doc.documentKey,
      clauses: doc.clauses,
    } as never);

    doc.clauses = clauses as never;
    doc.currentVersion += 1;
    doc.updatedBy = actorId;
    await doc.save();

    this.log.log(`Contrato ${doc.reference} agora na versão ${doc.currentVersion}.`);
    return toDto(doc.toObject() as Contract);
  }

  async transition(
    tenantId: string,
    actorId: string,
    id: string,
    to: ContractStatus,
  ): Promise<ContractDto> {
    const doc = await this.model.findOne({ tenantId, id }).exec();
    if (!doc) throw new NotFoundException(`Contrato ${id} não encontrado.`);

    if (!TRANSITIONS[doc.status].includes(to)) {
      throw new ConflictException(
        `Transição inválida: "${doc.status}" não pode ir para "${to}". ` +
          `Possíveis: ${TRANSITIONS[doc.status].join(', ') || 'nenhuma'}.`,
      );
    }

    if (to === 'active' && (!doc.effectiveFrom || !doc.parties.length)) {
      throw new ConflictException(
        'Para ativar, o contrato precisa de data de vigência inicial e ao menos uma parte.',
      );
    }

    doc.status = to;
    doc.updatedBy = actorId;
    await doc.save();

    if (to === 'active') {
      const counterparty = doc.parties.find((p) => p.role === 'counterparty');
      await this.bus.publish(
        'legal.contract.activated',
        {
          contractId: doc.id,
          reference: doc.reference,
          counterpartyId: counterparty?.externalRef ?? counterparty?.id ?? doc.id,
          effectiveFrom: doc.effectiveFrom!,
          effectiveTo: doc.effectiveTo,
        },
        { tenantId, actorId },
      );
    }

    return toDto(doc.toObject() as Contract);
  }

  /**
   * Contracts approaching their end date. Drives both the dashboard panel and
   * the daily notice job — one query, so the two can never disagree.
   */
  async expiring(tenantId: string, withinDays = 60): Promise<ContractDto[]> {
    const today = new Date();
    const limit = new Date();
    limit.setDate(limit.getDate() + withinDays);

    const docs = await this.model
      .find({
        tenantId,
        status: 'active',
        effectiveTo: {
          $ne: null,
          $gte: today.toISOString().slice(0, 10),
          $lte: limit.toISOString().slice(0, 10),
        },
      })
      .sort({ effectiveTo: 1 })
      .select('-versions')
      .lean()
      .exec();

    return docs.map((d) => toDto(d as unknown as Contract));
  }

  /** Presigned PUT so the browser uploads the signed PDF straight to R2. */
  async uploadTicket(tenantId: string, id: string, filename: string, contentType: string) {
    const contract = await this.findOne(tenantId, id);
    const key = this.storage.buildKey(tenantId, 'legal', contract.id, filename);
    return this.storage.uploadTicket(key, contentType);
  }

  /** Called once the browser reports the upload finished. */
  async attachDocument(tenantId: string, actorId: string, id: string, key: string) {
    const doc = await this.model.findOne({ tenantId, id }).exec();
    if (!doc) throw new NotFoundException(`Contrato ${id} não encontrado.`);

    // The key is generated by uploadTicket() and must be inside this tenant's
    // prefix — otherwise a caller could attach another tenant's document.
    if (!key.startsWith(`${tenantId}/legal/${id}/`)) {
      throw new ConflictException('Chave de documento inválida para este contrato.');
    }

    doc.documentKey = key;
    doc.updatedBy = actorId;
    await doc.save();
    return toDto(doc.toObject() as Contract);
  }

  async documentTicket(tenantId: string, id: string) {
    const contract = await this.findOne(tenantId, id);
    if (!contract.documentKey) {
      throw new NotFoundException('Este contrato ainda não tem documento anexado.');
    }
    return this.storage.downloadTicket(contract.documentKey);
  }

  private async nextReference(tenantId: string, kind: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `${kind.toUpperCase().slice(0, 3)}-${year}-`;
    const last = await this.model
      .findOne({ tenantId, reference: new RegExp(`^${prefix}`) })
      .sort({ reference: -1 })
      .select('reference')
      .lean()
      .exec();

    const n = last ? Number(String(last.reference).slice(prefix.length)) : 0;
    return `${prefix}${String(n + 1).padStart(4, '0')}`;
  }
}

function toDto(c: Contract): ContractDto {
  return {
    id: c.id,
    tenantId: c.tenantId,
    reference: c.reference,
    title: c.title,
    kind: c.kind as never,
    status: c.status,
    parties: c.parties as never,
    governingLaw: c.governingLaw,
    jurisdiction: c.jurisdiction,
    effectiveFrom: c.effectiveFrom,
    effectiveTo: c.effectiveTo,
    renewalNoticeDays: c.renewalNoticeDays,
    autoRenew: c.autoRenew,
    value: c.value,
    risk: c.risk as never,
    tags: c.tags,
    currentVersion: c.currentVersion,
    clauses: c.clauses as never,
    obligations: c.obligations as never,
    documentKey: c.documentKey,
    createdAt: c.createdAt.toISOString(),
    createdBy: c.createdBy,
    updatedAt: c.updatedAt.toISOString(),
    updatedBy: c.updatedBy,
  };
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!createdAt || !id) throw new NotFoundException('Cursor de paginação inválido.');
  return { createdAt, id };
}
