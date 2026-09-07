import { resolveRef } from '../common/resolve-ref';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  GoodsReceipt,
  GoodsReceiptItem,
  Material,
  Plant,
  PurchaseOrder,
  PurchaseOrderItem,
  Supplier,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { StockService } from '../production/stock.service';
import { poReceiptStatus } from './purchase.util';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Goods receipt not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const round3 = (v: number): number => Math.round((Number(v) || 0) * 1000) / 1000;
/** Over-delivery allowance on a PO line before a GRN is rejected (bulk material
 *  often arrives a little over) — a gross mis-key (e.g. 200 t on a 20 t PO) is
 *  still blocked. Amend the PO to receive more than this. */
const OVER_RECEIPT_TOLERANCE = 0.1;

/**
 * Goods receipts (Plan D2) — the multi-line GRN. Receiving records what actually
 * came in against a purchase order (or ad-hoc); POSTING it increases stock via
 * the shared ledger (exactly like a single-line material inward) and rolls the
 * received quantity back onto the PO lines, advancing the PO's receipt status.
 */
@Injectable()
export class GrnService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(GoodsReceipt).find({ where: status ? { status } : {}, order: { createdAt: 'DESC' } }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const grn = await m.getRepository(GoodsReceipt).findOne({ where: { id } });
    if (!grn) throw notFound();
    const items = await m.getRepository(GoodsReceiptItem).find({ where: { goodsReceiptId: id }, order: { createdAt: 'ASC' } });
    return { ...grn, items };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    const lines = Array.isArray(dto.lines) ? (dto.lines as Record<string, unknown>[]) : [];
    if (!lines.length) throw badReq('At least one line is required');

    return this.db.runInTenant(tenantId, async (m) => {
      const purchaseOrderId = (dto.purchaseOrderId as string) || null;
      let po: PurchaseOrder | null = null;
      if (purchaseOrderId) {
        po = await m.getRepository(PurchaseOrder).findOne({ where: { id: purchaseOrderId } });
        if (!po) throw badReq('Purchase order not found');
        if (po.status === 'cancelled') throw badReq('Cannot receive against a cancelled purchase order');
      }

      // Header references: with a PO named, its supplier and plant are
      // authoritative (a differing value would file the receipt under another
      // supplier or plant); without one, a supplied id must resolve inside the
      // tenant — FK checks bypass RLS, so a foreign UUID used to be accepted.
      const supplierIdIn = (dto.supplierId as string) || null;
      const plantIdIn = (dto.plantId as string) || null;
      if (po) {
        if (supplierIdIn && po.supplierId && supplierIdIn !== po.supplierId) throw badReq('supplierId does not match the purchase order');
        if (plantIdIn && po.plantId && plantIdIn !== po.plantId) throw badReq('plantId does not match the purchase order');
      } else {
        if (supplierIdIn) await resolveRef(m, Supplier, supplierIdIn, 'Supplier');
        if (plantIdIn) await resolveRef(m, Plant, plantIdIn, 'Plant');
      }

      const grnNo = await this.numbering.next(m, tenantId, 'goods_receipt', 'GRN-');
      const grnRepo = m.getRepository(GoodsReceipt);
      const grn = await grnRepo.save(
        grnRepo.create({
          tenantId, grnNo, purchaseOrderId,
          supplierId: supplierIdIn ?? po?.supplierId ?? null,
          plantId: plantIdIn ?? po?.plantId ?? null,
          receiptDate: (dto.receiptDate as string) ?? null,
          vehicleNo: (dto.vehicleNo as string) ?? null,
          supplierChallanNo: (dto.supplierChallanNo as string) ?? null,
          status: 'draft', remarks: (dto.remarks as string) ?? null,
        }),
      );

      const itemRepo = m.getRepository(GoodsReceiptItem);
      const materialRepo = m.getRepository(Material);
      const poItemRepo = m.getRepository(PurchaseOrderItem);
      // Accumulate this GRN's received per PO line so multiple lines against one
      // PO item are capped together, not each on its own.
      const receivedThisGrn = new Map<string, number>();
      for (const line of lines) {
        const materialId = (line.materialId as string) || null;
        const received = num(line.receivedQuantity);
        if (received <= 0) throw badReq('Each line needs a received quantity greater than zero');
        // Default accepted to received when the QC hasn't rejected anything.
        const accepted = line.acceptedQuantity !== undefined ? num(line.acceptedQuantity) : received;
        if (accepted < 0 || accepted > received + 0.0005) throw badReq('Accepted quantity must be between 0 and received');
        // The GRN rate is informational for stock (the ledger moves quantity, not
        // value), but a bill auto-populated from this GRN copies the rate straight
        // in — so a negative here seeds a negative-taxable payable. Refuse it.
        const rate = num(line.rate);
        if (rate < 0) throw badReq('Each line rate must be zero or more');

        // Cap the received quantity at the PO line's ordered amount (plus a
        // small over-delivery tolerance), counting what earlier posted GRNs and
        // this GRN's other lines already receive — so a mis-key can't book far
        // more than was ordered.
        const poItemId = (line.purchaseOrderItemId as string) || null;
        if (poItemId) {
          // The PO line must belong to THIS receipt's purchase order. Resolved by
          // id alone, another PO's line (or a dangling id) was accepted: that PO's
          // received_quantity was inflated on post, its genuine receipts were then
          // blocked by the cap and it became uncancellable, and a bill against it
          // passed the 3-way match for goods never received against it.
          if (!purchaseOrderId) {
            throw badReq('A line can only cite a purchase-order line when the receipt names its purchase order');
          }
          const poItem = await poItemRepo.findOne({ where: { id: poItemId, purchaseOrderId } });
          if (!poItem) throw badReq('Purchase-order line not found on this purchase order');
          const soFar = (receivedThisGrn.get(poItemId) ?? 0) + received;
          receivedThisGrn.set(poItemId, soFar);
          const ordered = num(poItem.quantity);
          const cap = ordered * (1 + OVER_RECEIPT_TOLERANCE);
          if (ordered > 0 && num(poItem.receivedQuantity) + soFar > cap + 0.0005) {
            const label = (line.materialLabel as string) || materialId || 'this material';
            throw badReq(
              `Received quantity exceeds the ordered amount for ${label} ` +
                `(ordered ${ordered}, already received ${num(poItem.receivedQuantity)}). ` +
                'Amend the purchase order to receive more.',
            );
          }
        }
        let materialLabel: string | null = (line.materialLabel as string) ?? null;
        let uom: string | null = (line.uom as string) ?? null;
        if (materialId && (!materialLabel || !uom)) {
          const material = await materialRepo.findOne({ where: { id: materialId } });
          materialLabel = materialLabel ?? material?.materialName ?? null;
          uom = uom ?? material?.uom ?? null;
        }
        await itemRepo.save(
          itemRepo.create({
            tenantId, goodsReceiptId: grn.id,
            purchaseOrderItemId: (line.purchaseOrderItemId as string) || null,
            materialId, materialLabel, uom,
            receivedQuantity: String(received), acceptedQuantity: String(accepted),
            rate: String(rate), remarks: (line.remarks as string) ?? null,
          }),
        );
      }
      return this.loadFull(m, grn.id);
    });
  }

  /**
   * Post a draft GRN: increase stock for each accepted line via the shared
   * ledger, roll the received quantity onto the PO lines, and advance the PO's
   * receipt status. Idempotency is guarded by the draft→posted transition.
   */
  post(tenantId: string, id: string, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const grnRepo = m.getRepository(GoodsReceipt);
      // Lock the GRN row so two concurrent posts serialize: the second blocks until
      // the first commits, then re-reads status='posted' and is rejected. Without
      // this an ad-hoc GRN (no PO line to lock below) could post its stock twice.
      const grn = await grnRepo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!grn) throw notFound();
      if (grn.status !== 'draft') throw badReq(`Goods receipt already ${grn.status}`);
      const items = await m.getRepository(GoodsReceiptItem).find({ where: { goodsReceiptId: id } });

      // Re-validate the over-receipt cap at POST time. The create-time cap reads
      // received_quantity, which only advances on post, so two concurrent drafts
      // can each pass it; here received_quantity reflects every already-posted
      // GRN. Lock the PO-line rows (pessimistic write) so two posts racing on the
      // same line serialize — the second sees the first's quantity and is blocked.
      if (grn.purchaseOrderId) {
        // Re-check the PO at POST time (create checked it at draft time): a PO
        // cancelled while this receipt sat in draft must not acquire received
        // quantity — that made a cancelled PO billable. Locked, so a concurrent
        // cancel waits for this post and then refuses on received > 0.
        const po = await m
          .getRepository(PurchaseOrder)
          .findOne({ where: { id: grn.purchaseOrderId }, lock: { mode: 'pessimistic_write' } });
        if (!po) throw badReq('Purchase order not found');
        if (po.status === 'cancelled' || po.status === 'closed') {
          throw badReq(`Cannot post a receipt against a ${po.status} purchase order`);
        }
        const poItemRepo = m.getRepository(PurchaseOrderItem);
        const perLine = new Map<string, number>();
        for (const it of items) {
          if (!it.purchaseOrderItemId) continue;
          perLine.set(it.purchaseOrderItemId, (perLine.get(it.purchaseOrderItemId) ?? 0) + num(it.receivedQuantity));
        }
        for (const [poItemId, thisGrnQty] of perLine) {
          const poItem = await poItemRepo.findOne({
            where: { id: poItemId, purchaseOrderId: grn.purchaseOrderId }, lock: { mode: 'pessimistic_write' },
          });
          if (!poItem) throw badReq('A receipt line cites a purchase-order line that is not on this purchase order');
          const ordered = num(poItem.quantity);
          if (ordered <= 0) continue;
          const cap = ordered * (1 + OVER_RECEIPT_TOLERANCE);
          if (num(poItem.receivedQuantity) + thisGrnQty > cap + 0.0005) {
            throw badReq(
              `Posting this receipt would exceed the ordered quantity (ordered ${ordered}, ` +
                `already received ${num(poItem.receivedQuantity)}). Amend the purchase order or reduce the receipt.`,
            );
          }
        }
      }

      for (const it of items) {
        const accepted = num(it.acceptedQuantity);
        if (it.materialId && accepted > 0) {
          await this.stock.applyDeltaWithin(m, tenantId, {
            plantId: grn.plantId, materialId: it.materialId, materialLabel: it.materialLabel, uom: it.uom,
            delta: accepted, txnType: 'inward',
            referenceType: 'goods_receipt', referenceId: grn.id,
            remarks: `GRN ${grn.grnNo}`, createdBy: userId,
          });
        }
      }

      if (grn.purchaseOrderId) {
        await this.rollUpPurchaseOrder(m, grn.purchaseOrderId, items);
      }

      await grnRepo.update(id, { status: 'posted' });
      return this.loadFull(m, id);
    });
  }

  /** Cancel a DRAFT receipt: nothing was posted, so nothing to unwind. */
  cancel(tenantId: string, id: string, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(GoodsReceipt);
      const grn = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!grn) throw notFound();
      if (grn.status !== 'draft') throw badReq(`Only a draft receipt can be cancelled — this one is ${grn.status}. A posted receipt is reversed instead.`);
      await repo.update(id, { status: 'cancelled', remarks: grn.remarks ? `${grn.remarks} (cancelled)` : 'Cancelled' });
      void userId;
      return this.loadFull(m, id);
    });
  }

  /**
   * Reverse a POSTED receipt (data-integrity item I18): the stock it booked is
   * taken back through the ledger (an `inward_reversal` movement, so the trail
   * shows both legs), every PO line it advanced is wound back (clamped at 0)
   * and the PO status recomputed, and the receipt is marked `reversed`.
   * Previously a GRN posted for 22 t when 12 t arrived could only be patched by
   * a stock adjustment: received_quantity stayed 22, the PO could never be
   * closed correctly, the real second delivery was refused by the cap and a
   * 22 t supplier bill passed the 3-way match.
   *
   * Refused while a live vendor bill cites this receipt (the bill's 3-way match
   * was computed against it — cancel the bill first). If stock has since been
   * consumed below the reversed quantity the balance goes negative — the
   * reversal records a booking error, it does not invent stock — and shows in
   * the negative-stock report like any other shortfall. Audited.
   */
  async reverse(tenantId: string, id: string, userId: string, reason?: string) {
    const { grnNo, lines } = await this.db.runInTenant(tenantId, async (m) => {
      const grnRepo = m.getRepository(GoodsReceipt);
      const grn = await grnRepo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!grn) throw notFound();
      if (grn.status === 'reversed') throw badReq('Receipt is already reversed');
      if (grn.status !== 'posted') throw badReq(`Only a posted receipt can be reversed — this one is ${grn.status}`);
      const [bills] = await m.query(
        `SELECT count(*)::int AS n FROM vendor_bills WHERE goods_receipt_id = $1 AND status <> 'cancelled'`, [id]);
      if (Number(bills?.n ?? 0) > 0) {
        throw badReq('A vendor bill references this receipt — cancel the bill before reversing the receipt');
      }
      if (grn.purchaseOrderId) {
        // Lock the PO (same order as post: GRN → PO → PO lines) so a concurrent
        // post/cancel on the PO serializes with this reversal.
        await m.getRepository(PurchaseOrder).findOne({ where: { id: grn.purchaseOrderId }, lock: { mode: 'pessimistic_write' } });
      }
      const items = await m.getRepository(GoodsReceiptItem).find({ where: { goodsReceiptId: id } });
      for (const it of items) {
        const accepted = num(it.acceptedQuantity);
        if (it.materialId && accepted > 0) {
          await this.stock.applyDeltaWithin(m, tenantId, {
            plantId: grn.plantId, materialId: it.materialId, materialLabel: it.materialLabel, uom: it.uom,
            delta: -accepted, txnType: 'inward_reversal',
            referenceType: 'goods_receipt', referenceId: grn.id,
            remarks: `GRN ${grn.grnNo} reversed${reason ? `: ${reason}` : ''}`, createdBy: userId,
          });
        }
      }
      if (grn.purchaseOrderId) await this.rollUpPurchaseOrder(m, grn.purchaseOrderId, items, -1);
      await grnRepo.update(id, { status: 'reversed', remarks: reason ? `Reversed: ${reason}` : grn.remarks });
      return { grnNo: grn.grnNo, lines: items.length };
    });
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.GRN_REVERSE,
      entityType: 'goods_receipt', entityId: id, entityLabel: grnNo,
      summary: `Reversed goods receipt ${grnNo} (${lines} line(s))${reason ? ` — ${reason}` : ''}`,
      details: { lines, reason: reason ?? null },
    });
    return this.get(tenantId, id);
  }

  /**
   * Add (sign +1) or take back (sign −1) each received quantity on its PO line
   * and recompute the PO's status. Lines are locked; a reversal clamps at 0.
   */
  private async rollUpPurchaseOrder(m: EntityManager, purchaseOrderId: string, grnItems: GoodsReceiptItem[], sign: 1 | -1 = 1) {
    const poItemRepo = m.getRepository(PurchaseOrderItem);
    // Nothing on this receipt cites a PO line → nothing to roll up, and the PO's
    // status must not be recomputed from untouched lines (that wrote
    // 'not_received' over an issued PO).
    if (!grnItems.some((it) => it.purchaseOrderItemId)) return;
    for (const it of grnItems) {
      if (!it.purchaseOrderItemId) continue;
      const poItem = await poItemRepo.findOne({
        where: { id: it.purchaseOrderItemId, purchaseOrderId }, lock: { mode: 'pessimistic_write' },
      });
      if (!poItem) throw badReq('A receipt line cites a purchase-order line that is not on this purchase order');
      const received = round3(Math.max(0, num(poItem.receivedQuantity) + sign * num(it.receivedQuantity)));
      await poItemRepo.update(poItem.id, { receivedQuantity: String(received) });
    }
    const poItems = await poItemRepo.find({ where: { purchaseOrderId } });
    const status = poReceiptStatus(poItems.map((i) => ({ ordered: num(i.quantity), received: num(i.receivedQuantity) })));
    // Never downgrade a cancelled/closed PO; only reflect receipt progress.
    const poRepo = m.getRepository(PurchaseOrder);
    const po = await poRepo.findOne({ where: { id: purchaseOrderId } });
    if (po && po.status !== 'cancelled' && po.status !== 'closed') {
      await poRepo.update(purchaseOrderId, { status });
    }
  }
}
