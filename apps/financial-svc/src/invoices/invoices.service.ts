import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  computeTotals,
  isSameCurrency,
  money,
  type CreateInvoice,
  type Invoice,
  type InvoiceFilter,
  type InvoiceStatus,
  type Page,
  type PageQuery,
  type RecordPayment,
  type UpdateInvoice,
} from '@ssm/contracts';
import { EventBusService, ObjectStorageService, correlationId } from '@ssm/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { OutboxEntity } from '../database/outbox.entity.js';
import { InvoiceLineEntity } from './invoice-line.entity.js';
import { InvoiceEntity } from './invoice.entity.js';

/**
 * Legal transitions. Anything not listed is rejected — an invoice cannot go
 * back to draft once issued, and a paid invoice cannot be voided without a
 * credit note, which is a separate document.
 */
const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['issued', 'void'],
  issued: ['partially_paid', 'paid', 'void'],
  partially_paid: ['paid', 'void'],
  paid: [],
  void: [],
};

@Injectable()
export class InvoicesService {
  private readonly log = new Logger(InvoicesService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly bus: EventBusService,
    private readonly storage: ObjectStorageService,
  ) {}

  // --- queries -------------------------------------------------------------

  async list(
    tenantId: string,
    filter: InvoiceFilter,
    page: PageQuery,
  ): Promise<Page<Invoice>> {
    const qb = this.db
      .getRepository(InvoiceEntity)
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.lines', 'l')
      // Tenant scoping is the first predicate on every query, without exception.
      //
      // Note these are ENTITY PROPERTY names (tenantId), not column names
      // (tenant_id). The query builder resolves them through the entity
      // metadata; hand it a raw column name and orderBy + take fails at
      // runtime with "Cannot read properties of undefined (reading
      // 'databaseName')", because there is no property by that name to look up.
      .where('i.tenantId = :tenantId', { tenantId });

    if (filter.status) qb.andWhere('i.status = :status', { status: filter.status });
    if (filter.counterpartyId)
      qb.andWhere('i.counterpartyId = :cp', { cp: filter.counterpartyId });
    if (filter.dueBefore) qb.andWhere('i.dueDate <= :before', { before: filter.dueBefore });
    if (filter.dueAfter) qb.andWhere('i.dueDate >= :after', { after: filter.dueAfter });
    if (filter.q) {
      // The expression must match invoices_search_trgm_idx character for
      // character, or the planner will not use the index and the search falls
      // back to a full scan. Index and query are one decision, made in
      // apps/financial-svc/src/database/migrations/1747100000000.
      //
      // The value is parameterised — never concatenated into the SQL. Zen would
      // flag the alternative, but the right answer is not to write it.
      qb.andWhere(
        `(coalesce(i.number, '') || ' ' || coalesce(i.counterparty_name, '')) ILIKE :q`,
        { q: `%${filter.q}%` },
      );
    }

    // Keyset pagination on (created_at, id): stable under concurrent inserts,
    // unlike OFFSET which silently skips or repeats rows as the table changes.
    if (page.cursor) {
      const { createdAt, id } = decodeCursor(page.cursor);
      // A row-value comparison, which has no property-name equivalent, so the
      // real column names are used and the alias is quoted explicitly.
      qb.andWhere('("i"."created_at", "i"."id") < (:createdAt, :id)', { createdAt, id });
    }

    qb.orderBy('i.createdAt', 'DESC').addOrderBy('i.id', 'DESC').take(page.limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > page.limit;
    const items = hasMore ? rows.slice(0, page.limit) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map(toDto),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async findOne(tenantId: string, id: string): Promise<Invoice> {
    const entity = await this.db
      .getRepository(InvoiceEntity)
      .findOne({ where: { id, tenantId }, relations: { lines: true } });

    // Same 404 whether the invoice belongs to another tenant or does not exist:
    // a 403 here would confirm the id is real to someone who should not know.
    if (!entity) throw new NotFoundException(`Fatura ${id} não encontrada.`);
    return toDto(entity);
  }

  // --- commands ------------------------------------------------------------

  async create(tenantId: string, actorId: string, dto: CreateInvoice): Promise<Invoice> {
    const totals = computeTotals(dto.lines);

    return this.db.transaction(async (tx) => {
      const invoice = tx.create(InvoiceEntity, {
        tenantId,
        status: 'draft',
        number: null,
        counterpartyId: dto.counterpartyId,
        counterpartyName: dto.counterpartyName,
        issueDate: null,
        dueDate: dto.dueDate,
        currency: dto.currency.toUpperCase(),
        subtotalMinor: totals.subtotalMinor,
        taxTotalMinor: totals.taxTotalMinor,
        totalMinor: totals.totalMinor,
        amountPaidMinor: 0,
        notes: dto.notes ?? null,
        documentKey: null,
        createdBy: actorId,
        updatedBy: actorId,
      });

      const saved = await tx.save(invoice);

      saved.lines = await tx.save(
        dto.lines.map((line, i) =>
          tx.create(InvoiceLineEntity, {
            invoiceId: saved.id,
            position: i,
            description: line.description,
            quantityMilli: line.quantityMilli,
            unitPriceMinor: line.unitPrice.amountMinor,
            taxRateBps: line.taxRateBps ?? 0,
            lineTotalMinor: totals.lines[i]!.lineTotalMinor,
          }),
        ),
      );

      this.log.log(`Fatura ${saved.id} criada como rascunho.`);
      return toDto(saved);
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateInvoice,
  ): Promise<Invoice> {
    return this.db.transaction(async (tx) => {
      const invoice = await this.lockOne(tx, tenantId, id);

      // The amounts on an issued invoice are a legal record. Correcting one
      // means voiding it and issuing a replacement, not editing in place.
      if (invoice.status !== 'draft') {
        throw new ConflictException(
          `Somente rascunhos podem ser alterados. Esta fatura está em "${invoice.status}". ` +
            'Cancele-a e emita uma nova.',
        );
      }

      Object.assign(invoice, {
        counterpartyId: dto.counterpartyId ?? invoice.counterpartyId,
        counterpartyName: dto.counterpartyName ?? invoice.counterpartyName,
        dueDate: dto.dueDate ?? invoice.dueDate,
        currency: (dto.currency ?? invoice.currency).toUpperCase(),
        notes: dto.notes ?? invoice.notes,
        updatedBy: actorId,
      });

      if (dto.lines) {
        const totals = computeTotals(dto.lines);
        await tx.delete(InvoiceLineEntity, { invoiceId: id });
        invoice.lines = await tx.save(
          dto.lines.map((line, i) =>
            tx.create(InvoiceLineEntity, {
              invoiceId: id,
              position: i,
              description: line.description,
              quantityMilli: line.quantityMilli,
              unitPriceMinor: line.unitPrice.amountMinor,
              taxRateBps: line.taxRateBps ?? 0,
              lineTotalMinor: totals.lines[i]!.lineTotalMinor,
            }),
          ),
        );
        invoice.subtotalMinor = totals.subtotalMinor;
        invoice.taxTotalMinor = totals.taxTotalMinor;
        invoice.totalMinor = totals.totalMinor;
      }

      await tx.save(invoice);
      return toDto(invoice);
    });
  }

  async issue(tenantId: string, actorId: string, id: string): Promise<Invoice> {
    return this.db.transaction(async (tx) => {
      const invoice = await this.lockOne(tx, tenantId, id);
      this.assertTransition(invoice.status, 'issued');

      if (!invoice.lines.length) {
        throw new BadRequestException('Uma fatura sem itens não pode ser emitida.');
      }

      invoice.number = await this.nextNumber(tx, tenantId);
      invoice.status = 'issued';
      invoice.issueDate = new Date().toISOString().slice(0, 10);
      invoice.updatedBy = actorId;
      await tx.save(invoice);

      // Same transaction as the state change — see the outbox note in
      // libs/nest-common/src/messaging/outbox.ts.
      await this.enqueue(tx, invoice, 'financial.invoice.issued', {
        invoiceId: invoice.id,
        number: invoice.number,
        counterpartyId: invoice.counterpartyId,
        total: money(invoice.totalMinor, invoice.currency),
        dueDate: invoice.dueDate,
      }, actorId);

      this.log.log(`Fatura ${invoice.number} emitida.`);
      return toDto(invoice);
    });
  }

  async recordPayment(
    tenantId: string,
    actorId: string,
    id: string,
    dto: RecordPayment,
  ): Promise<Invoice> {
    return this.db.transaction(async (tx) => {
      const invoice = await this.lockOne(tx, tenantId, id);

      if (!isSameCurrency(dto.amount, invoice.currency)) {
        throw new BadRequestException(
          `Moeda divergente: o pagamento está em ${dto.amount.currency} e a fatura em ` +
            `${invoice.currency}. Registre o pagamento na moeda da fatura.`,
        );
      }

      if (invoice.status !== 'issued' && invoice.status !== 'partially_paid') {
        throw new ConflictException(
          `Não é possível registrar pagamento em uma fatura "${invoice.status}".`,
        );
      }
      if (dto.amount.amountMinor <= 0) {
        throw new BadRequestException('O valor do pagamento deve ser positivo.');
      }

      const paid = invoice.amountPaidMinor + dto.amount.amountMinor;
      if (paid > invoice.totalMinor) {
        throw new BadRequestException(
          `O pagamento excede o saldo em aberto ` +
            `(${invoice.totalMinor - invoice.amountPaidMinor} restantes).`,
        );
      }

      invoice.amountPaidMinor = paid;
      invoice.status = paid === invoice.totalMinor ? 'paid' : 'partially_paid';
      invoice.updatedBy = actorId;
      await tx.save(invoice);

      if (invoice.status === 'paid') {
        await this.enqueue(tx, invoice, 'financial.invoice.paid', {
          invoiceId: invoice.id,
          paidAt: dto.paidAt,
          amount: money(invoice.totalMinor, invoice.currency),
        }, actorId);
      }

      return toDto(invoice);
    });
  }

  async void(tenantId: string, actorId: string, id: string, reason: string): Promise<Invoice> {
    return this.db.transaction(async (tx) => {
      const invoice = await this.lockOne(tx, tenantId, id);
      this.assertTransition(invoice.status, 'void');

      invoice.status = 'void';
      invoice.updatedBy = actorId;
      await tx.save(invoice);

      await this.enqueue(tx, invoice, 'financial.invoice.voided', {
        invoiceId: invoice.id,
        reason,
      }, actorId);

      return toDto(invoice);
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const invoice = await this.db
      .getRepository(InvoiceEntity)
      .findOne({ where: { id, tenantId } });
    if (!invoice) throw new NotFoundException(`Fatura ${id} não encontrada.`);

    // Anything that was ever issued is part of the audit trail. Voiding keeps
    // the record and the number; deleting would leave a gap in the sequence,
    // which is exactly what an auditor looks for.
    if (invoice.status !== 'draft') {
      throw new ConflictException(
        'Somente rascunhos podem ser excluídos. Cancele a fatura para mantê-la no histórico.',
      );
    }
    await this.db.getRepository(InvoiceEntity).delete({ id, tenantId });
  }

  /** Presigned GET for the rendered PDF. */
  async documentTicket(tenantId: string, id: string) {
    const invoice = await this.findOne(tenantId, id);
    if (!invoice.documentKey) {
      throw new NotFoundException('Esta fatura ainda não tem documento gerado.');
    }
    return this.storage.downloadTicket(invoice.documentKey);
  }

  // --- helpers -------------------------------------------------------------

  /**
   * SELECT ... FOR UPDATE. Two concurrent payments on the same invoice would
   * otherwise both read amountPaid, both add their amount, and the second write
   * would overwrite the first — losing a payment.
   */
  private async lockOne(tx: EntityManager, tenantId: string, id: string): Promise<InvoiceEntity> {
    // The lock is taken on the invoice row alone, with no relations loaded:
    // Postgres rejects FOR UPDATE against the nullable side of an outer join,
    // so joining lines here would make the lock impossible to take. It is also
    // what we want semantically — the thing being serialised is the invoice.
    const invoice = await tx.findOne(InvoiceEntity, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!invoice) throw new NotFoundException(`Fatura ${id} não encontrada.`);

    // Loaded separately, after the lock is held.
    invoice.lines = await tx.find(InvoiceLineEntity, {
      where: { invoiceId: id },
      order: { position: 'ASC' },
    });
    return invoice;
  }

  private assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
    if (!TRANSITIONS[from].includes(to)) {
      throw new ConflictException(
        `Transição inválida: "${from}" não pode ir para "${to}". ` +
          `Transições possíveis: ${TRANSITIONS[from].join(', ') || 'nenhuma'}.`,
      );
    }
  }

  /**
   * Gapless per-tenant sequence. A Postgres sequence would be faster but leaves
   * gaps on rollback, and tax authorities in several jurisdictions treat a gap
   * in invoice numbering as a finding. The row lock taken above serialises this.
   */
  private async nextNumber(tx: EntityManager, tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `FAT-${year}-`;
    const [row] = (await tx.query(
      `SELECT number FROM invoices
        WHERE tenant_id = $1 AND number LIKE $2
        ORDER BY number DESC LIMIT 1
        FOR UPDATE`,
      [tenantId, `${prefix}%`],
    )) as Array<{ number: string }>;

    const last = row ? Number(row.number.slice(prefix.length)) : 0;
    return `${prefix}${String(last + 1).padStart(5, '0')}`;
  }

  private async enqueue(
    tx: EntityManager,
    invoice: InvoiceEntity,
    type: string,
    payload: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    await tx.insert(OutboxEntity, {
      id: randomUUID(),
      aggregateType: 'invoice',
      aggregateId: invoice.id,
      type,
      // TypeORM's QueryDeepPartialEntity walks object properties looking for
      // nested entities; a jsonb column is opaque data, so it has to be told
      // to store the object as-is.
      payload: payload as never,
      tenantId: invoice.tenantId,
      actorId,
      correlationId: correlationId(),
      attempts: 0,
      publishedAt: null,
      lastError: null,
    });
  }
}

// --- mapping ---------------------------------------------------------------

function toDto(e: InvoiceEntity): Invoice {
  const currency = e.currency;
  return {
    id: e.id,
    tenantId: e.tenantId,
    number: e.number,
    status: e.status,
    counterpartyId: e.counterpartyId,
    counterpartyName: e.counterpartyName,
    issueDate: e.issueDate,
    dueDate: e.dueDate,
    currency,
    lines: [...(e.lines ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        id: l.id,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unitPrice: money(l.unitPriceMinor, currency),
        taxRateBps: l.taxRateBps,
        lineTotal: money(l.lineTotalMinor, currency),
      })),
    subtotal: money(e.subtotalMinor, currency),
    taxTotal: money(e.taxTotalMinor, currency),
    total: money(e.totalMinor, currency),
    amountPaid: money(e.amountPaidMinor, currency),
    notes: e.notes ?? undefined,
    documentKey: e.documentKey,
    createdAt: e.createdAt.toISOString(),
    createdBy: e.createdBy,
    updatedAt: e.updatedAt.toISOString(),
    updatedBy: e.updatedBy,
  };
}

/** Opaque to the client — base64url of the sort key, not a page number. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!createdAt || !id) throw new BadRequestException('Cursor de paginação inválido.');
  return { createdAt, id };
}
