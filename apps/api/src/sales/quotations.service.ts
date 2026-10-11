import { listLimit } from '../common/list-limit.util';
import { attachCustomerName } from '../common/attach-customer-name';
import { assertSalesRefs } from './sales-refs.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
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
import { companyBlock, type QuotationPdfData } from './pdf.service';
import { quotationShareMessage } from '../common/share-messages.util';
import { documentDay, userNames } from '../common/user-names';
import { estimateLineValue } from '@rmc/shared';
import { lineEstimateInput, pickChargeBases, readBillingTerms } from '../billing/charge-basis.util';

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
  'transportBasis',
  'pumpBasis',
  'waitingBasis',
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

  /**
   * Newest quotations first, each with the customer and site names and a
   * summary of its lines (grade count, total m³ and the ex-GST value, priced
   * per m³ exactly as the order draft prices them) so the list can show what
   * a quotation is worth without opening it.
   */
  list(tenantId: string, limit?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.getRepository(Quotation).find({ order: { createdAt: 'DESC' }, take: listLimit(limit) });
      const named = await attachCustomerName(m, rows);
      const siteIds = [...new Set(rows.map((r) => r.siteId).filter((v): v is string => !!v))];
      const sites: Array<{ id: string; siteName: string }> = siteIds.length
        ? await m.query(`SELECT id, site_name AS "siteName" FROM sites WHERE id = ANY($1)`, [siteIds])
        : [];
      const siteName = new Map(sites.map((s) => [s.id, s.siteName]));
      const ids = rows.map((r) => r.id);
      // Each line is valued under its charge bases (a per-trip transport
      // charge counts trips at the tenant's truck load), exactly as the order
      // draft will value it — so the list says what the quotation is worth.
      const { truckM3 } = await readBillingTerms(m);
      const lineRows = ids.length ? await m.getRepository(QuotationItem).find({ where: { quotationId: In(ids) } }) : [];
      const sum = new Map<string, { itemCount: number; totalM3: number; estimatedValue: number }>();
      for (const it of lineRows) {
        const e = sum.get(it.quotationId) ?? { itemCount: 0, totalM3: 0, estimatedValue: 0 };
        e.itemCount += 1;
        e.totalM3 += num(it.estimatedQuantity);
        e.estimatedValue += estimateLineValue(lineEstimateInput(it, it.estimatedQuantity, truckM3));
        sum.set(it.quotationId, e);
      }
      return named.map((r) => {
        const s = sum.get(r.id);
        return {
          ...r,
          siteName: r.siteId ? siteName.get(r.siteId) ?? null : null,
          itemCount: s?.itemCount ?? 0,
          totalM3: s?.totalM3 ?? 0,
          estimatedValue: s?.estimatedValue ?? 0,
        };
      });
    });
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
    const { truckM3 } = await readBillingTerms(m);
    const taxSummary = summariseGst(
      items.map((it) => ({
        quantity: num(it.estimatedQuantity), rate: num(it.ratePerM3),
        transport: num(it.transportCharge), pump: num(it.pumpCharge), waiting: num(it.waitingCharge),
        transportBasis: it.transportBasis, pumpBasis: it.pumpBasis, waitingBasis: it.waitingBasis, truckM3,
        gstRate: num(it.gstRate), gstApplicable: it.gstApplicable,
      })),
      interstate,
    );
    // Names for the screen header: who the quotation is for and where it pours,
    // who prepared it (the sales user, else the login that raised it) and who
    // approved it.
    const site = quotation.siteId ? await m.getRepository(Site).findOne({ where: { id: quotation.siteId } }) : null;
    const nameOf = await userNames(m, [quotation.salesUserId, quotation.createdBy, quotation.approvedBy]);
    return {
      ...quotation,
      customerName: customer?.customerName ?? null,
      siteName: site?.siteName ?? null,
      preparedByName: nameOf(quotation.salesUserId) ?? nameOf(quotation.createdBy),
      approvedByName: quotation.approvalStatus === 'approved' ? nameOf(quotation.approvedBy) : null,
      approvedAt: quotation.approvalStatus === 'approved' ? quotation.approvedAt : null,
      items,
      taxSummary,
      // The truck load the per-trip estimate counts with, so the screen's
      // live read-out and the saved totals agree.
      truckM3,
    };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  create(tenantId: string, dto: Record<string, unknown>, createdBy?: string | null) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Quotation);
      const quotationNo = await this.numbering.next(m, tenantId, 'quotation', 'QTN-');
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId', 'quotationNo', 'revisionNo', 'approvalStatus', 'createdBy', 'approvedBy', 'approvedAt']) delete rest[k];
      // `status` (active/converted) is the conversion state — set only by the
      // order path and by createRevision, never from the client body.
      delete rest.status;
      delete rest.items;
      assertValidity(rest.quotationDate, rest.validUntil);
      await assertSalesRefs(m, rest);
      const quotation = await repo.save(
        repo.create({
          ...rest,
          tenantId,
          quotationNo,
          approvalStatus: 'draft',
          revisionNo: 0,
          createdBy: createdBy ?? null,
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
      for (const k of ['id', 'tenantId', 'quotationNo', 'revisionNo', 'approvalStatus', 'status', 'items', 'createdBy', 'approvedBy', 'approvedAt']) {
        delete rest[k];
      }
      assertValidity(rest.quotationDate ?? quotation.quotationDate, rest.validUntil ?? quotation.validUntil);
      await assertSalesRefs(m, rest, quotation.customerId);
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
    // The basis of each charge: per m³ unless the line says per trip / lump
    // sum / per job / per hour. Anything else is refused by name.
    Object.assign(out, pickChargeBases(raw));
    return out;
  }

  addItem(tenantId: string, quotationId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const quotation = await m.getRepository(Quotation).findOne({ where: { id: quotationId } });
      if (!quotation) throw notFound();
      // Items are the priced content of the quote: once approved they are as
      // locked as the header (conversion copies their prices onto the order).
      if (quotation.approvalStatus === 'approved') {
        throw badReq('Approved quotation is locked; create a revision to change it');
      }
      const repo = m.getRepository(QuotationItem);
      await repo.save(repo.create({ ...this.pickItem(dto), tenantId, quotationId }));
      return this.loadFull(m, quotationId);
    });
  }

  updateItem(tenantId: string, quotationId: string, itemId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const quotation = await m.getRepository(Quotation).findOne({ where: { id: quotationId } });
      if (!quotation) throw notFound();
      if (quotation.approvalStatus === 'approved') {
        throw badReq('Approved quotation is locked; create a revision to change it');
      }
      const repo = m.getRepository(QuotationItem);
      const item = await repo.findOne({ where: { id: itemId, quotationId } });
      if (!item) throw notFound();
      await repo.update(itemId, this.pickItem(dto));
      return this.loadFull(m, quotationId);
    });
  }

  deleteItem(tenantId: string, quotationId: string, itemId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const quotation = await m.getRepository(Quotation).findOne({ where: { id: quotationId } });
      if (!quotation) throw notFound();
      if (quotation.approvalStatus === 'approved') {
        throw badReq('Approved quotation is locked; create a revision to change it');
      }
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
    return this.transition(tenantId, id, ['draft', 'rejected'], 'submitted', { approvedBy: null, approvedAt: null });
  }

  /** Approving records who and when: the PDF prints both under the terms. */
  async approve(tenantId: string, id: string, userId: string) {
    const full = await this.transition(tenantId, id, ['submitted'], 'approved', { approvedBy: userId, approvedAt: new Date() });
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
      approvedBy: null,
      approvedAt: null,
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
      // A revision reopens the quotation for editing AND for conversion: the
      // documented flow after a conversion is "revise to raise another", so a
      // converted quotation returns to 'active' here (the client-side status
      // write that used to be the workaround is no longer accepted).
      await m.getRepository(Quotation).update(id, {
        revisionNo: nextRev,
        approvalStatus: 'draft',
        status: 'active',
        // The earlier approval belongs to the snapshot, not to the new draft.
        approvedBy: null,
        approvedAt: null,
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
        ...companyBlock(company),
        quotationNo: full.quotationNo,
        quotationDate: full.quotationDate,
        validUntil: full.validUntil,
        revisionNo: full.revisionNo,
        approvalStatus: full.approvalStatus,
        customerName: customer?.customerName ?? 'Customer',
        customerAddress: [customer?.billingAddress, customer?.city, customer?.state, customer?.pincode].map((v) => String(v ?? '').trim()).filter(Boolean).join(', ') || null,
        siteName: site?.siteName ?? null,
        paymentTerms: full.paymentTerms,
        remarks: full.remarks,
        preparedByName: full.preparedByName,
        approvedByName: full.approvedByName,
        approvedOn: documentDay(full.approvedAt),
        items: full.items.map((it) => ({
          gradeLabel: it.gradeLabel ?? '',
          estimatedQuantity: it.estimatedQuantity,
          ratePerM3: it.ratePerM3,
          transportCharge: it.transportCharge,
          pumpCharge: it.pumpCharge,
          waitingCharge: it.waitingCharge,
          transportBasis: it.transportBasis,
          pumpBasis: it.pumpBasis,
          waitingBasis: it.waitingBasis,
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
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];
      const message = (dto.message as string) ?? quotationShareMessage({
        companyName: company?.companyName ?? 'Your supplier', quotationNo: full.quotationNo, revisionNo: full.revisionNo,
        quotationDate: full.quotationDate, validUntil: full.validUntil,
      });
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
