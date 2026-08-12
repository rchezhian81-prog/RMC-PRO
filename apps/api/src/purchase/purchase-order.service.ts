import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Material, PurchaseOrder, PurchaseOrderItem, Supplier } from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Purchase order not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;

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

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(PurchaseOrder).find({ where: status ? { status } : {}, order: { createdAt: 'DESC' } }),
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

      const poNo = await this.numbering.next(m, tenantId, 'purchase_order', 'PO-');
      const poRepo = m.getRepository(PurchaseOrder);
      const po = await poRepo.save(
        poRepo.create({
          tenantId, poNo, supplierId,
          plantId: (dto.plantId as string) ?? null,
          orderDate: (dto.orderDate as string) ?? null,
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
        const rate = num(line.rate);
        const gstRate = line.gstRate !== undefined ? num(line.gstRate) : 18;
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
      const po = await repo.findOne({ where: { id } });
      if (!po) throw notFound();
      if (po.status !== 'draft') throw badReq(`Purchase order already ${po.status}`);
      await repo.update(id, { status: 'issued' });
      return this.loadFull(m, id);
    });
  }

  /** Cancel a PO — only before anything has been received against it. */
  cancel(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(PurchaseOrder);
      const po = await repo.findOne({ where: { id } });
      if (!po) throw notFound();
      if (po.status === 'cancelled') throw badReq('Purchase order already cancelled');
      const items = await m.getRepository(PurchaseOrderItem).find({ where: { purchaseOrderId: id } });
      if (items.some((i) => num(i.receivedQuantity) > 0.0005)) throw badReq('Cannot cancel a PO with goods already received');
      await repo.update(id, { status: 'cancelled' });
      return this.loadFull(m, id);
    });
  }
}
