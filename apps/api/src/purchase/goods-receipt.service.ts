import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  GoodsReceipt,
  GoodsReceiptItem,
  Material,
  PurchaseOrder,
  PurchaseOrderItem,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { StockService } from '../production/stock.service';
import { poReceiptStatus } from './purchase.util';

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

      const grnNo = await this.numbering.next(m, tenantId, 'goods_receipt', 'GRN-');
      const grnRepo = m.getRepository(GoodsReceipt);
      const grn = await grnRepo.save(
        grnRepo.create({
          tenantId, grnNo, purchaseOrderId,
          supplierId: (dto.supplierId as string) ?? po?.supplierId ?? null,
          plantId: (dto.plantId as string) ?? po?.plantId ?? null,
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

        // Cap the received quantity at the PO line's ordered amount (plus a
        // small over-delivery tolerance), counting what earlier posted GRNs and
        // this GRN's other lines already receive — so a mis-key can't book far
        // more than was ordered.
        const poItemId = (line.purchaseOrderItemId as string) || null;
        if (poItemId) {
          const poItem = await poItemRepo.findOne({ where: { id: poItemId } });
          if (poItem) {
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
            rate: String(num(line.rate)), remarks: (line.remarks as string) ?? null,
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
      const grn = await grnRepo.findOne({ where: { id } });
      if (!grn) throw notFound();
      if (grn.status !== 'draft') throw badReq(`Goods receipt already ${grn.status}`);
      const items = await m.getRepository(GoodsReceiptItem).find({ where: { goodsReceiptId: id } });

      // Re-validate the over-receipt cap at POST time. The create-time cap reads
      // received_quantity, which only advances on post, so two concurrent drafts
      // can each pass it; here received_quantity reflects every already-posted
      // GRN. Lock the PO-line rows (pessimistic write) so two posts racing on the
      // same line serialize — the second sees the first's quantity and is blocked.
      if (grn.purchaseOrderId) {
        const poItemRepo = m.getRepository(PurchaseOrderItem);
        const perLine = new Map<string, number>();
        for (const it of items) {
          if (!it.purchaseOrderItemId) continue;
          perLine.set(it.purchaseOrderItemId, (perLine.get(it.purchaseOrderItemId) ?? 0) + num(it.receivedQuantity));
        }
        for (const [poItemId, thisGrnQty] of perLine) {
          const poItem = await poItemRepo.findOne({ where: { id: poItemId }, lock: { mode: 'pessimistic_write' } });
          if (!poItem) continue;
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

  /** Add each received quantity to its PO line and recompute the PO's status. */
  private async rollUpPurchaseOrder(m: EntityManager, purchaseOrderId: string, grnItems: GoodsReceiptItem[]) {
    const poItemRepo = m.getRepository(PurchaseOrderItem);
    for (const it of grnItems) {
      if (!it.purchaseOrderItemId) continue;
      const poItem = await poItemRepo.findOne({ where: { id: it.purchaseOrderItemId } });
      if (!poItem) continue;
      const received = round3(num(poItem.receivedQuantity) + num(it.receivedQuantity));
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
