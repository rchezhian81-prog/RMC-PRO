import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Material, NegativeStockRequest } from '../core/database/entities';
import { StockService } from '../production/stock.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Request not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Manual stock adjustment with negative-stock gating (Design Doc 6 §12.5).
 * An adjustment that keeps stock >= 0 applies immediately. A decrease that would
 * drive stock negative is NOT applied — it raises a negative_stock_request that
 * an approver (negative_stock.approve) must clear before the reduction posts.
 */
@Injectable()
export class StockAdjustmentService {
  constructor(
    private readonly db: TenantDbService,
    private readonly stock: StockService,
  ) {}

  adjust(tenantId: string, dto: Record<string, unknown>, userId: string) {
    const materialId = String(dto.materialId ?? '');
    if (!materialId) throw badReq('materialId required');
    const plantId = (dto.plantId as string) ?? null;
    const qty = Math.abs(num(dto.quantity));
    if (qty <= 0) throw badReq('quantity must be greater than zero');
    const direction = dto.direction === 'decrease' ? 'decrease' : 'increase';
    const delta = direction === 'decrease' ? -qty : qty;
    const reason = (dto.reason as string) ?? null;

    return this.db.runInTenant(tenantId, async (m) => {
      const material = await m.getRepository(Material).findOne({ where: { id: materialId } });
      const label = material?.materialName ?? null;
      const uom = material?.uom ?? null;
      const current = await this.stock.balanceOf(m, plantId, materialId);
      const newBalance = current + delta;

      if (delta < 0 && newBalance < 0) {
        const repo = m.getRepository(NegativeStockRequest);
        const request = await repo.save(
          repo.create({
            tenantId, plantId, materialId, materialLabel: label,
            availableQuantity: String(current), requiredQuantity: String(qty),
            negativeQuantity: String(Math.abs(newBalance)),
            referenceType: 'stock_adjustment', referenceId: null,
            requestedBy: userId, requestReason: reason, approvalStatus: 'pending',
          }),
        );
        return { pendingApproval: true, request };
      }

      const balanceAfter = await this.stock.applyDeltaWithin(m, tenantId, {
        plantId, materialId, materialLabel: label, uom, delta, txnType: 'adjustment',
        referenceType: 'stock_adjustment', referenceId: null,
        remarks: reason ?? 'Stock adjustment', createdBy: userId,
      });
      return { pendingApproval: false, balanceAfter };
    });
  }
}

/** Approval queue for negative-stock requests (negative_stock.approve). */
@Injectable()
export class NegativeStockService {
  constructor(
    private readonly db: TenantDbService,
    private readonly stock: StockService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(NegativeStockRequest).find({
        where: status ? { approvalStatus: status } : {},
        order: { createdAt: 'DESC' },
      }),
    );
  }

  approve(tenantId: string, id: string, userId: string, remarks?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(NegativeStockRequest);
      const req = await repo.findOne({ where: { id } });
      if (!req) throw notFound();
      if (req.approvalStatus !== 'pending') throw badReq(`Request already ${req.approvalStatus}`);
      if (!req.materialId) throw badReq('Request has no material');

      const material = await m.getRepository(Material).findOne({ where: { id: req.materialId } });
      await this.stock.applyDeltaWithin(m, tenantId, {
        plantId: req.plantId, materialId: req.materialId, materialLabel: req.materialLabel,
        uom: material?.uom ?? null, delta: -num(req.requiredQuantity), txnType: 'negative_stock',
        referenceType: 'negative_stock_request', referenceId: req.id,
        remarks: `Approved negative stock: ${req.requestReason ?? ''}`, createdBy: userId,
      });
      await repo.update(id, { approvalStatus: 'approved', approvedBy: userId, approvedAt: new Date(), approvalRemarks: remarks ?? null });
      return repo.findOne({ where: { id } });
    });
  }

  reject(tenantId: string, id: string, userId: string, remarks?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(NegativeStockRequest);
      const req = await repo.findOne({ where: { id } });
      if (!req) throw notFound();
      if (req.approvalStatus !== 'pending') throw badReq(`Request already ${req.approvalStatus}`);
      await repo.update(id, { approvalStatus: 'rejected', approvedBy: userId, approvedAt: new Date(), approvalRemarks: remarks ?? null });
      return repo.findOne({ where: { id } });
    });
  }
}
