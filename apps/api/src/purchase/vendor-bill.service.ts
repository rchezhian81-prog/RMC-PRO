import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  Company,
  GoodsReceipt,
  GoodsReceiptItem,
  PurchaseOrderItem,
  Supplier,
  VendorBill,
  VendorBillItem,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { isInterstateSupply } from '../billing/tax.util';
import { summariseMatch, deriveGstSplit, type MatchLineInput } from './purchase.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Vendor bill not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;

/**
 * Vendor bills (Plan D2) — the supplier's invoice, 3-way matched against the
 * purchase order (rate) and the goods receipt (accepted quantity). A bill can be
 * created from a posted GRN (lines default from what was accepted) and carries a
 * `match_status`; approving it commits the payable (audited).
 */
@Injectable()
export class VendorBillService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(VendorBill).find({ where: status ? { status } : {}, order: { createdAt: 'DESC' } }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const bill = await m.getRepository(VendorBill).findOne({ where: { id } });
    if (!bill) throw notFound();
    const items = await m.getRepository(VendorBillItem).find({ where: { vendorBillId: id }, order: { createdAt: 'ASC' } });
    return { ...bill, items };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  /**
   * Input-tax-credit (ITC) register — approved vendor bills over a period, with
   * the supplier's GSTIN and the CGST/SGST vs IGST split derived from the stored
   * tax and the supplier-vs-company state test. For claiming ITC and reconciling
   * with GSTR-2B.
   */
  itcRegister(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const bills = (await m.getRepository(VendorBill).find({ where: { status: 'approved' }, order: { billDate: 'ASC' } }))
        .filter((b) => (!from || (b.billDate ?? '') >= from) && (!to || (b.billDate ?? '') <= to));
      const suppliers = await m.getRepository(Supplier).find();
      const supOf = new Map(suppliers.map((s) => [s.id, s]));
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];
      const rows = bills.map((b) => {
        const s = b.supplierId ? supOf.get(b.supplierId) : null;
        const interstate = isInterstateSupply(company?.state, s?.state);
        const split = deriveGstSplit(num(b.taxAmount), interstate);
        return {
          billNo: b.billNo, supplierBillNo: b.supplierBillNo, billDate: b.billDate,
          supplierName: s?.supplierName ?? '', gstin: s?.gstin ?? '',
          taxable: round2(num(b.taxableAmount)), ...split, total: round2(num(b.totalAmount)),
        };
      });
      const sum = (f: (r: (typeof rows)[number]) => number) => round2(rows.reduce((acc, r) => acc + num(f(r)), 0));
      const totals = {
        taxable: sum((r) => r.taxable), cgst: sum((r) => r.cgst), sgst: sum((r) => r.sgst),
        igst: sum((r) => r.igst), total: sum((r) => r.total), count: rows.length,
      };
      return { rows, totals };
    });
  }

  /**
   * Create a draft bill. Lines may be supplied explicitly; otherwise, when a GRN
   * is given, they default from the GRN's accepted quantities. The 3-way match
   * (billed qty ≤ accepted, billed rate ≈ PO rate) is computed and stored.
   */
  create(tenantId: string, dto: Record<string, unknown>) {
    const supplierId = String(dto.supplierId ?? '');
    if (!supplierId) throw badReq('supplierId required');

    return this.db.runInTenant(tenantId, async (m) => {
      const goodsReceiptId = (dto.goodsReceiptId as string) || null;
      let grn: GoodsReceipt | null = null;
      let grnItems: GoodsReceiptItem[] = [];
      if (goodsReceiptId) {
        grn = await m.getRepository(GoodsReceipt).findOne({ where: { id: goodsReceiptId } });
        if (!grn) throw badReq('Goods receipt not found');
        if (grn.status !== 'posted') throw badReq('Bill can only be raised against a posted goods receipt');
        grnItems = await m.getRepository(GoodsReceiptItem).find({ where: { goodsReceiptId } });
      }
      const purchaseOrderId = (dto.purchaseOrderId as string) || grn?.purchaseOrderId || null;

      // Lines: explicit if given, else derived from the GRN's accepted quantities.
      let lines = Array.isArray(dto.lines) ? (dto.lines as Record<string, unknown>[]) : [];
      if (!lines.length && grnItems.length) {
        lines = grnItems
          .filter((it) => num(it.acceptedQuantity) > 0)
          .map((it) => ({
            purchaseOrderItemId: it.purchaseOrderItemId, materialId: it.materialId, materialLabel: it.materialLabel,
            uom: it.uom, quantity: it.acceptedQuantity, rate: it.rate,
          }));
      }
      if (!lines.length) throw badReq('At least one line is required');

      const billNo = await this.numbering.next(m, tenantId, 'purchase_bill', 'BILL-');
      const billRepo = m.getRepository(VendorBill);
      const bill = await billRepo.save(
        billRepo.create({
          tenantId, billNo,
          supplierBillNo: (dto.supplierBillNo as string) ?? null,
          supplierId, purchaseOrderId, goodsReceiptId,
          billDate: (dto.billDate as string) ?? null,
          dueDate: (dto.dueDate as string) ?? null,
          status: 'draft', paymentStatus: 'unpaid',
        }),
      );

      const itemRepo = m.getRepository(VendorBillItem);
      const poItemRepo = m.getRepository(PurchaseOrderItem);
      const matchInputs: MatchLineInput[] = [];
      let taxable = 0, tax = 0;
      for (const line of lines) {
        const quantity = num(line.quantity);
        if (quantity <= 0) throw badReq('Each line needs a quantity greater than zero');
        const rate = num(line.rate);
        const poItemId = (line.purchaseOrderItemId as string) || null;
        const poItem = poItemId ? await poItemRepo.findOne({ where: { id: poItemId } }) : null;
        // Inherit the GST rate the PO agreed (cement 28%, diesel 0, fly-ash /
        // admixture 5–18%…) rather than a blanket 18%, unless the caller passed
        // an explicit rate on the line.
        const gstRate = line.gstRate !== undefined ? num(line.gstRate) : poItem ? num(poItem.gstRate) : 18;
        const lineTaxable = round2(quantity * rate);
        const lineTax = round2((lineTaxable * gstRate) / 100);
        await itemRepo.save(
          itemRepo.create({
            tenantId, vendorBillId: bill.id, purchaseOrderItemId: poItemId,
            materialId: (line.materialId as string) || null, materialLabel: (line.materialLabel as string) ?? null,
            uom: (line.uom as string) ?? null,
            quantity: String(quantity), rate: String(rate), gstRate: String(gstRate),
            taxableAmount: String(lineTaxable), taxAmount: String(lineTax),
            lineTotal: String(round2(lineTaxable + lineTax)),
          }),
        );
        taxable = round2(taxable + lineTaxable);
        tax = round2(tax + lineTax);

        // Build a 3-way match input when we can tie the line to a PO line.
        if (poItem) {
          const grnItem = grnItems.find((g) => g.purchaseOrderItemId === poItemId);
          const acceptedQty = grnItem ? num(grnItem.acceptedQuantity) : num(poItem.receivedQuantity);
          matchInputs.push({ billedQty: quantity, billedRate: rate, orderedRate: num(poItem.rate), acceptedQty });
        }
      }

      const total = round2(taxable + tax);
      // With PO lines to compare, run the 3-way match; otherwise it's unmatched.
      const matchStatus = matchInputs.length ? summariseMatch(matchInputs).status : 'unmatched';
      await billRepo.update(bill.id, {
        taxableAmount: String(taxable), taxAmount: String(tax), totalAmount: String(total),
        outstandingAmount: String(total), matchStatus,
      });
      return this.loadFull(m, bill.id);
    });
  }

  /**
   * Approve a draft bill — commits the payable. A bill that fails the 3-way
   * match (quantity or price over tolerance vs the PO/GRN) is blocked unless the
   * caller passes overrideMatch, mirroring the batch-ticket variance override —
   * otherwise the match control the module advertises did nothing at the gate.
   * Audited, with the override recorded.
   */
  async approve(tenantId: string, id: string, userId: string, overrideMatch = false) {
    const { result, billNo, total, matchStatus, overridden } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(VendorBill);
      const bill = await repo.findOne({ where: { id } });
      if (!bill) throw notFound();
      if (bill.status !== 'draft') throw badReq(`Vendor bill already ${bill.status}`);
      const failsMatch = bill.matchStatus === 'over_tolerance';
      if (failsMatch && !overrideMatch) {
        throw badReq('Vendor bill fails the 3-way match (quantity/price over tolerance). Resolve the mismatch or approve with override.');
      }
      await repo.update(id, { status: 'approved' });
      return { result: await this.loadFull(m, id), billNo: bill.billNo, total: bill.totalAmount, matchStatus: bill.matchStatus, overridden: failsMatch };
    });
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.VENDOR_BILL_APPROVE,
      entityType: 'vendor_bill', entityId: id, entityLabel: billNo,
      summary: `Approved vendor bill ${billNo} (₹${total}) — match ${matchStatus ?? 'n/a'}${overridden ? ' (match override)' : ''}`.trim(),
      details: { totalAmount: total, matchStatus, overrideMatch: overridden },
    });
    return result;
  }

  /** Cancel a draft bill (never one with payments against it). */
  cancel(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(VendorBill);
      const bill = await repo.findOne({ where: { id } });
      if (!bill) throw notFound();
      if (bill.status === 'cancelled') throw badReq('Vendor bill already cancelled');
      if (num(bill.paidAmount) > 0.001) throw badReq('Cannot cancel a bill with payments recorded');
      await repo.update(id, { status: 'cancelled', paymentStatus: 'cancelled' });
      return this.loadFull(m, id);
    });
  }
}
