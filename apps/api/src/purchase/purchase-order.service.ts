import { listLimit } from '../common/list-limit.util';
import { resolveRef } from '../common/resolve-ref';
import { round2 } from '../common/money.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Material, Plant, PurchaseOrder, PurchaseOrderItem, Supplier } from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { documentDate } from '../common/business-date.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Purchase order not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Purchase orders (Plan D2). A PO commits to buying materials from a supplier at
 * agreed rates; goods receipts fulfil it and vendor bills are matched against
 * it. GST is carried per line (rate + tax) so the PO total reconciles with the
 * eventual bill.
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
  ) {}

  list(tenantId: string, status?: string, limit?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(PurchaseOrder).find({ where: status ? { status } : {}, order: { createdAt: 'DESC' }, take: listLimit(limit) }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const po = await m.getRepository(PurchaseOrder).findOne({ where: { id } });
    if (!po) throw notFound();
    const items = await m.getRepository(PurchaseOrderItem).find({ where: { purchaseOrderId: id }, order: { createdAt: 'ASC' } });
    return { ...po, items };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    const supplierId = String(dto.supplierId ?? '');
    if (!supplierId) throw badReq('supplierId required');
    const lines = Array.isArray(dto.lines) ? (dto.lines as Record<string, unknown>[]) : [];
    if (!lines.length) throw badReq('At least one line is required');

    return this.db.runInTenant(tenantId, async (m) => {
      const supplier = await m.getRepository(Supplier).findOne({ where: { id: supplierId } });
      if (!supplier) throw badReq('Supplier not found');
      if (dto.plantId) await resolveRef(m, Plant, dto.plantId, 'Plant');

      const poNo = await this.numbering.next(m, tenantId, 'purchase_order', 'PO-');
      const poRepo = m.getRepository(PurchaseOrder);
      const po = await poRepo.save(
        poRepo.create({
          tenantId, poNo, supplierId,
          plantId: (dto.plantId as string) ?? null,
          orderDate: documentDate(dto.orderDate),
          expectedDate: (dto.expectedDate as string) ?? null,
          status: 'draft', remarks: (dto.remarks as string) ?? null,
        }),
      );

      const itemRepo = m.getRepository(PurchaseOrderItem);
      const materialRepo = m.getRepository(Material);
      let taxable = 0, tax = 0;
      for (const line of lines) {
        const materialId = (line.materialId as string) || null;
        const quantity = num(line.quantity);
        if (quantity <= 0) throw badReq('Each line needs a quantity greater than zero');
        const rate = round2(num(line.rate));
        const gstRate = round2(line.gstRate !== undefined ? num(line.gstRate) : 18);
        const lineTaxable = round2(quantity * rate);
        const lineTax = round2((lineTaxable * gstRate) / 100);
        let materialLabel: string | null = (line.materialLabel as string) ?? null;
        if (!materialLabel && materialId) {
          const material = await materialRepo.findOne({ where: { id: materialId } });
          materialLabel = material?.materialName ?? null;
        }
        await itemRepo.save(
          itemRepo.create({
            tenantId, purchaseOrderId: po.id, materialId, materialLabel,
            uom: (line.uom as string) ?? null,
            quantity: String(quantity), rate: String(rate), gstRate: String(gstRate),
            taxableAmount: String(lineTaxable), taxAmount: String(lineTax),
            lineTotal: String(round2(lineTaxable + lineTax)), receivedQuantity: '0',
          }),
        );
        taxable = round2(taxable + lineTaxable);
        tax = round2(tax + lineTax);
      }

      await poRepo.update(po.id, {
        taxableAmount: String(taxable), taxAmount: String(tax), totalAmount: String(round2(taxable + tax)),
      });
      return this.loadFull(m, po.id);
    });
  }

  /** Issue a draft PO — commits it so goods can be received against it. */
  issue(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(PurchaseOrder);
      // Locked, like cancel below and like VendorBillService.approve: this read
      // was unlocked, so a cancel could commit between it and the UPDATE and be
      // overwritten — a purchase order somebody deliberately cancelled came back
      // as 'issued', which a goods receipt will happily receive against and a
      // bill will happily be raised for.
      const po = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!po) throw notFound();
      if (po.status !== 'draft') throw badReq(`Purchase order already ${po.status}`);
      // Conditional on the status we just validated — belt-and-braces under the
      // lock, the same shape the vendor-bill paths use.
      const res = await repo.update({ id, status: 'draft' }, { status: 'issued' });
      if (!res.affected) throw badReq('Purchase order is no longer a draft');
      return this.loadFull(m, id);
    });
  }

  /** Cancel a PO — only before anything has been received against it. */
  cancel(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(PurchaseOrder);
      // Locked: GRN post locks the PO too, so a cancel racing a post waits and
      // then sees the received quantity (or the post sees the cancellation).
      const po = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!po) throw notFound();
      if (po.status === 'cancelled') throw badReq('Purchase order already cancelled');
      const items = await m.getRepository(PurchaseOrderItem).find({ where: { purchaseOrderId: id } });
      if (items.some((i) => num(i.receivedQuantity) > 0.0005)) throw badReq('Cannot cancel a PO with goods already received');
      // A draft receipt against this PO would otherwise post later onto a
      // cancelled order (received quantity on a cancelled PO, then billable).
      const [drafts] = await m.query(
        `SELECT count(*)::int AS n FROM goods_receipts WHERE purchase_order_id = $1 AND status = 'draft'`, [id]);
      if (Number(drafts?.n ?? 0) > 0) {
        throw badReq('This purchase order has draft goods receipts — cancel or post them first');
      }
      await repo.update(id, { status: 'cancelled' });
      return this.loadFull(m, id);
    });
  }
}
