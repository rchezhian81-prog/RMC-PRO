import { resolveRef } from '../common/resolve-ref';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Material, NegativeStockRequest, StockTransaction } from '../core/database/entities';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { StockService } from '../production/stock.service';
import { listLimit } from '../common/list-limit.util';

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

  /** History of applied adjustments — the adjustment rows from the stock ledger. */
  list(tenantId: string, limit?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(StockTransaction).find({
        where: { transactionType: 'adjustment' },
        order: { createdAt: 'DESC' },
        take: listLimit(limit),
      }),
    );
  }

  adjust(tenantId: string, dto: Record<string, unknown>, userId: string) {
    const materialId = String(dto.materialId ?? '');
    if (!materialId) throw badReq('materialId required');
    const qty = Math.abs(num(dto.quantity));
    if (qty <= 0) throw badReq('quantity must be greater than zero');
    const direction = dto.direction === 'decrease' ? 'decrease' : 'increase';
    const delta = direction === 'decrease' ? -qty : qty;
    const reason = (dto.reason as string) ?? null;

    return this.db.runInTenant(tenantId, async (m) => {
      // Resolve the plant the SAME way the write path does, then read the balance
      // for that plant. Reading with the raw (often null) plantId matched the
      // IS-NULL ghost row and returned 0, so every decrease on a single-plant
      // tenant was wrongly forced into the negative-stock approval queue.
      const plantId = await this.stock.resolvePlant(m, (dto.plantId as string) ?? null);
      // Serialize concurrent movements on this material so the negative-stock gate
      // below is not a TOCTOU: without it, two decreases each read the same
      // balance, each compute newBalance >= 0, and both apply — driving stock
      // negative past the approval the gate is meant to require.
      await this.stock.lockBalance(m, plantId, materialId);
      const material = await resolveRef(m, Material, materialId, 'Material');
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
    private readonly audit: AuditService,
  ) {}

  /**
   * The request list with what an approver reads it by: who asked and who
   * decided (names, not ids), the material's unit and code, the plant, and
   * the balance the material holds right now. Batched lookups.
   */
  list(tenantId: string, status?: string, limit?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.getRepository(NegativeStockRequest).find({
        where: status ? { approvalStatus: status } : {},
        order: { createdAt: 'DESC' },
        take: listLimit(limit),
      });
      const ids = (pick: (r: NegativeStockRequest) => string | null) => [...new Set(rows.map(pick).filter((v): v is string => !!v))];
      const userIds = [...new Set([...ids((r) => r.requestedBy), ...ids((r) => r.approvedBy)])];
      const materialIds = ids((r) => r.materialId);
      const plantIds = ids((r) => r.plantId);
      const [users, materials, plants, balances] = await Promise.all([
        userIds.length ? (m.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [userIds]) as Promise<Array<{ id: string; name: string }>>) : Promise.resolve([]),
        materialIds.length ? (m.query(`SELECT id, material_code AS "materialCode", uom FROM materials WHERE id = ANY($1)`, [materialIds]) as Promise<Array<{ id: string; materialCode: string; uom: string | null }>>) : Promise.resolve([]),
        plantIds.length ? (m.query(`SELECT id, plant_name AS "plantName" FROM plants WHERE id = ANY($1)`, [plantIds]) as Promise<Array<{ id: string; plantName: string }>>) : Promise.resolve([]),
        materialIds.length
          ? (m.query(`SELECT plant_id AS "plantId", material_id AS "materialId", current_quantity AS "currentQuantity" FROM stock_balances WHERE material_id = ANY($1)`, [materialIds]) as Promise<Array<{ plantId: string; materialId: string; currentQuantity: string }>>)
          : Promise.resolve([]),
      ]);
      const userName = new Map(users.map((u) => [u.id, u.name]));
      const material = new Map(materials.map((x) => [x.id, x]));
      const plantName = new Map(plants.map((p) => [p.id, p.plantName]));
      const balance = new Map(balances.map((b) => [`${b.plantId}:${b.materialId}`, Number(b.currentQuantity)]));
      return rows.map((r) => ({
        ...r,
        requestedByName: r.requestedBy ? userName.get(r.requestedBy) ?? null : null,
        approvedByName: r.approvedBy ? userName.get(r.approvedBy) ?? null : null,
        materialCode: r.materialId ? material.get(r.materialId)?.materialCode ?? null : null,
        uom: r.materialId ? material.get(r.materialId)?.uom ?? null : null,
        plantName: r.plantId ? plantName.get(r.plantId) ?? null : null,
        currentQuantity: r.plantId && r.materialId ? balance.get(`${r.plantId}:${r.materialId}`) ?? null : null,
      }));
    });
  }

  async approve(tenantId: string, id: string, userId: string, remarks?: string) {
    const { result, label, qty } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(NegativeStockRequest);
      // Lock the request row so the pending-state check below is not a TOCTOU:
      // without it two concurrent approves both read 'pending' and both post the
      // issue via applyDeltaWithin (an atomic decrement), driving stock negative
      // by twice the approved quantity. The lock serializes them — the loser then
      // reads 'approved' and is refused. Mirrors the pessimistic_write used on
      // every sibling state transition (material-inward, batch-tickets, GRN).
      const req = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
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
      return { result: await repo.findOne({ where: { id } }), label: req.materialLabel, qty: req.requiredQuantity };
    });
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.NEGATIVE_STOCK_APPROVE,
      entityType: 'negative_stock_request',
      entityId: id,
      entityLabel: label,
      summary: `Approved a negative-stock issue of ${qty} ${label ?? 'material'}`,
      details: { remarks: remarks ?? null, requiredQuantity: qty },
    });
    return result;
  }

  async reject(tenantId: string, id: string, userId: string, remarks?: string) {
    const { result, label } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(NegativeStockRequest);
      const req = await repo.findOne({ where: { id } });
      if (!req) throw notFound();
      if (req.approvalStatus !== 'pending') throw badReq(`Request already ${req.approvalStatus}`);
      await repo.update(id, { approvalStatus: 'rejected', approvedBy: userId, approvedAt: new Date(), approvalRemarks: remarks ?? null });
      return { result: await repo.findOne({ where: { id } }), label: req.materialLabel };
    });
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.NEGATIVE_STOCK_REJECT,
      entityType: 'negative_stock_request',
      entityId: id,
      entityLabel: label,
      summary: `Rejected a negative-stock request for ${label ?? 'material'}`,
      details: { remarks: remarks ?? null },
    });
    return result;
  }
}
