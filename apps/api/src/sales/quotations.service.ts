import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  Company,
  Customer,
  Quotation,
  QuotationItem,
  QuotationRevision,
  Site,
} from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import { summariseGst, isInterstateSupply } from '../billing/tax.util';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { NumberingService } from './numbering.service';
import { WhatsAppService } from './whatsapp.service';
import type { QuotationPdfData } from './pdf.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Not found' });
const badReq = (message: string) =>
  new BadRequestException({ code: 'VALIDATION_ERROR', message });

const ITEM_FIELDS = [
  'gradeId',
  'gradeLabel',
  'estimatedQuantity',
  'ratePerM3',
  'transportCharge',
  'pumpCharge',
  'waitingCharge',
  'gstApplicable',
  'gstRate',
  'remarks',
] as const;

/** A quotation must not be valid-until BEFORE its own date (dates are YYYY-MM-DD,
 *  so a string compare is a chronological compare). */
const assertValidity = (quotationDate: unknown, validUntil: unknown): void => {
  if (quotationDate && validUntil && String(validUntil) < String(quotationDate)) {
    throw badReq('The quotation’s valid-until date cannot be before its quotation date.');
  }
};

const num = (v: unknown): number => Number(v ?? 0) || 0;

/** Quotations: header, grade-wise items, approval flow, revisions, PDF, share. */
@Injectable()
export class QuotationsService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly whatsapp: WhatsAppService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(Quotation).find({ order: { createdAt: 'DESC' } }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const quotation = await m.getRepository(Quotation).findOne({ where: { id } });
    if (!quotation) throw notFound();
    const items = await m
      .getRepository(QuotationItem)
      .find({ where: { quotationId: id }, order: { createdAt: 'ASC' } });

    // Reconciling CGST/SGST/IGST breakup — freight is part of the taxable base,
    // inter/intra-state from the buyer's state vs the seller company's state.
    const company = (await m.getRepository(Company).find({ take: 1 }))[0];
    const customer = quotation.customerId
      ? await m.getRepository(Customer).findOne({ where: { id: quotation.customerId } })
      : null;
    const interstate = isInterstateSupply(company?.state, customer?.state);
    const taxSummary = summariseGst(
      items.map((it) => ({
        quantity: num(it.estimatedQuantity), rate: num(it.ratePerM3),
        transport: num(it.transportCharge), pump: num(it.pumpCharge), waiting: num(it.waitingCharge),
        gstRate: num(it.gstRate), gstApplicable: it.gstApplicable,
      })),
      interstate,
    );
    return { ...quotation, items, taxSummary };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Quotation);
      const quotationNo = await this.numbering.next(m, tenantId, 'quotation', 'QTN-');
      const rest = nullifyEmpty(dto);
      delete rest.id;
      delete rest.tenantId;
      delete rest.quotationNo;
      delete rest.revisionNo;
      delete rest.approvalStatus;
      delete rest.items;
      assertValidity(rest.quotationDate, rest.validUntil);
      const quotation = await repo.save(
        repo.create({
          ...rest,
          tenantId,
          quotationNo,
          approvalStatus: 'draft',
          revisionNo: 0,
        } as Record<string, unknown>),
      );
      // Optionally accept inline items on create.
      if (Array.isArray(dto.items)) {
        const itemRepo = m.getRepository(QuotationItem);
        for (const raw of dto.items as Record<string, unknown>[]) {
          await itemRepo.save(
            itemRepo.create({ ...this.pickItem(raw), tenantId, quotationId: quotation.id }),
          );
        }
      }
      return this.loadFull(m, quotation.id);
    });
  }

  update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Quotation);
      const quotation = await repo.findOne({ where: { id } });
      if (!quotation) throw notFound();
      if (quotation.approvalStatus === 'approved') {
        throw badReq('Approved quotation is locked; create a revision to change it');
      }
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId', 'quotationNo', 'revisionNo', 'approvalStatus', 'items']) {
        delete rest[k];
      }
      assertValidity(rest.quotationDate ?? quotation.quotationDate, rest.validUntil ?? quotation.validUntil);
      await repo.update(id, rest as Record<string, unknown>);
      return this.loadFull(m, id);
    });
  }

  // ---- Items -------------------------------------------------------------
  private pickItem(raw: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of ITEM_FIELDS) if (raw[f] !== undefined) out[f] = raw[f] === '' ? null : raw[f];
    // Reject negatives — a negative rate/charge/quantity understates the order
    // value (and so the credit exposure) and is meaningless on a quote line.
    for (const f of ['estimatedQuantity', 'ratePerM3', 'transportCharge', 'pumpCharge', 'waitingCharge', 'gstRate'] as const) {
      if (out[f] != null && Number(out[f]) < 0) throw badReq(`${f} cannot be negative`);
    }
    return out;
  }

  addItem(tenantId: string, quotationId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const quotation = await m.getRepository(Quotation).findOne({ where: { id: quotationId } });
      if (!quotation) throw notFound();
      const repo = m.getRepository(QuotationItem);
      await repo.save(repo.create({ ...this.pickItem(dto), tenantId, quotationId }));
      return this.loadFull(m, quotationId);
    });
  }

  updateItem(tenantId: string, quotationId: string, itemId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(QuotationItem);
      const item = await repo.findOne({ where: { id: itemId, quotationId } });
      if (!item) throw notFound();
      await repo.update(itemId, this.pickItem(dto));
      return this.loadFull(m, quotationId);
    });
  }

  deleteItem(tenantId: string, quotationId: string, itemId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(QuotationItem);
      const item = await repo.findOne({ where: { id: itemId, quotationId } });
      if (!item) throw notFound();
      await repo.delete(itemId);
      return this.loadFull(m, quotationId);
    });
  }

  // ---- Approval flow -----------------------------------------------------
  private transition(tenantId: string, id: string, from: string[], to: string, patch: Record<string, unknown> = {}) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Quotation);
      const quotation = await repo.findOne({ where: { id } });
      if (!quotation) throw notFound();
      if (!from.includes(quotation.approvalStatus)) {
        throw badReq(`Cannot move from ${quotation.approvalStatus} to ${to}`);
      }
      await repo.update(id, { approvalStatus: to, ...patch });
      return this.loadFull(m, id);
    });
  }

  submit(tenantId: string, id: string) {
    return this.transition(tenantId, id, ['draft', 'rejected'], 'submitted');
  }

  async approve(tenantId: string, id: string, userId: string) {
    const full = await this.transition(tenantId, id, ['submitted'], 'approved');
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.QUOTATION_APPROVE,
      entityType: 'quotation',
      entityId: id,
      entityLabel: full.quotationNo,
      summary: `Approved quotation ${full.quotationNo}`,
    });
    return full;
  }

  async reject(tenantId: string, id: string, userId: string, reason?: string) {
    const full = await this.transition(tenantId, id, ['submitted'], 'rejected', {
      remarks: reason ?? null,
    });
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.QUOTATION_REJECT,
      entityType: 'quotation',
      entityId: id,
      entityLabel: full.quotationNo,
      summary: `Rejected quotation ${full.quotationNo}${reason ? ` — ${reason}` : ''}`,
      details: { reason: reason ?? null },
    });
    return full;
  }

  // ---- Revision history --------------------------------------------------
  /** Snapshot the current header+items, bump revision_no, reopen as draft. */
  createRevision(tenantId: string, id: string, dto: Record<string, unknown>, changedBy?: string | null) {
    return this.db.runInTenant(tenantId, async (m) => {
      const full = await this.loadFull(m, id);
      const nextRev = Number(full.revisionNo) + 1;
      const revRepo = m.getRepository(QuotationRevision);
      await revRepo.save(
        revRepo.create({
          tenantId,
          quotationId: id,
          revisionNo: full.revisionNo,
          changedBy: changedBy ?? null,
          changeReason: (dto.changeReason as string) ?? null,
          snapshotJson: full as unknown,
        }),
      );
      await m.getRepository(Quotation).update(id, {
        revisionNo: nextRev,
        approvalStatus: 'draft',
      });
      return this.loadFull(m, id);
    });
  }

  listRevisions(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m
        .getRepository(QuotationRevision)
        .find({ where: { quotationId: id }, order: { revisionNo: 'DESC' } }),
    );
  }

  // ---- PDF data ----------------------------------------------------------
  async pdfData(tenantId: string, id: string): Promise<{ data: QuotationPdfData; quotation: Quotation }> {
    return this.db.runInTenant(tenantId, async (m) => {
      const full = await this.loadFull(m, id);
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];
      const customer = full.customerId
        ? await m.getRepository(Customer).findOne({ where: { id: full.customerId } })
        : null;
      const site = full.siteId
        ? await m.getRepository(Site).findOne({ where: { id: full.siteId } })
        : null;
      const data: QuotationPdfData = {
        companyName: company?.companyName ?? 'Company',
        companyGstin: company?.gstin ?? null,
        companyState: company?.state ?? null,
        quotationNo: full.quotationNo,
        quotationDate: full.quotationDate,
        validUntil: full.validUntil,
        revisionNo: full.revisionNo,
        approvalStatus: full.approvalStatus,
        customerName: customer?.customerName ?? 'Customer',
        siteName: site?.siteName ?? null,
        paymentTerms: full.paymentTerms,
        remarks: full.remarks,
        items: full.items.map((it) => ({
          gradeLabel: it.gradeLabel ?? '',
          estimatedQuantity: it.estimatedQuantity,
          ratePerM3: it.ratePerM3,
          transportCharge: it.transportCharge,
          pumpCharge: it.pumpCharge,
          waitingCharge: it.waitingCharge,
          gstApplicable: it.gstApplicable,
        })),
      };
      return { data, quotation: full };
    });
  }

  // ---- WhatsApp share foundation ----------------------------------------
  async share(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const full = await this.loadFull(m, id);
      const customer = full.customerId
        ? await m.getRepository(Customer).findOne({ where: { id: full.customerId } })
        : null;
      const mobile = (dto.mobile as string) ?? customer?.mobile ?? null;
      const message =
        (dto.message as string) ??
        `Quotation ${full.quotationNo} (rev ${full.revisionNo}) from us. Status: ${full.approvalStatus}. Please review.`;
      return this.whatsapp.logWithin(m, tenantId, {
        recipientMobile: mobile,
        moduleKey: 'sales',
        eventKey: 'quotation_share',
        referenceType: 'quotation',
        referenceId: id,
        message,
      });
    });
  }
}
