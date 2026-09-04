import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { leavesTerminal } from '../common/state-machine.util';
import {
  BatchQueueEntry,
  Order,
  OrderItem,
  ProductionPlan,
  ProductionPlanItem,
} from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import { NumberingService } from '../sales/numbering.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Plan not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/** Daily production planning (Design Doc 6 §10.1/§10.2). Consumes confirmed orders. */
@Injectable()
export class ProductionPlansService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
  ) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(ProductionPlan).find({ order: { createdAt: 'DESC' } }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const plan = await m.getRepository(ProductionPlan).findOne({ where: { id } });
    if (!plan) throw notFound();
    const items = await m
      .getRepository(ProductionPlanItem)
      .find({ where: { productionPlanId: id }, order: { sequenceNo: 'ASC', createdAt: 'ASC' } });
    return { ...plan, items };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  create(tenantId: string, dto: Record<string, unknown>, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(ProductionPlan);
      const planNo = await this.numbering.next(m, tenantId, 'production_plan', 'PLAN-');
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId', 'planNo', 'status', 'items']) delete rest[k];
      const plan = await repo.save(
        repo.create({ ...rest, tenantId, planNo, status: 'draft', createdBy: userId } as Record<string, unknown>),
      );
      return this.loadFull(m, plan.id);
    });
  }

  /** Add a planned line for a CONFIRMED order (optionally a specific line). */
  addItem(tenantId: string, planId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const plan = await m.getRepository(ProductionPlan).findOne({ where: { id: planId } });
      if (!plan) throw notFound();
      const orderId = String(dto.orderId ?? '');
      if (!orderId) throw badReq('orderId required');
      const order = await m.getRepository(Order).findOne({ where: { id: orderId } });
      if (!order) throw badReq('Order not found');
      if (order.orderStatus !== 'confirmed') throw badReq('Only a confirmed order can be planned');

      // A production-plan line is grade-specific, so it must resolve to an order
      // LINE — that's where the grade + mix design come from. Callers may name the
      // line (orderItemId) or the grade directly; when they name neither, resolve
      // from the order's lines. NEVER create a grade-less plan line (it silently
      // dead-ends batching with "no approved mix design"): one line → use it,
      // several → make the caller pick.
      let gradeId: string | null = (dto.gradeId as string) ?? null;
      let gradeLabel: string | null = (dto.gradeLabel as string) ?? null;
      let plannedQty = Number(dto.plannedQuantityM3 ?? 0);
      let orderItemId = (dto.orderItemId as string) ?? null;
      // The ordered quantity for this plan line, used to cap over-planning below.
      let orderedQtyM3: number | null = null;
      if (orderItemId) {
        const oi = await m.getRepository(OrderItem).findOne({ where: { id: orderItemId, orderId } });
        if (!oi) throw badReq('Order line (orderItemId) not found for this order');
        gradeId = gradeId ?? oi.gradeId;
        gradeLabel = gradeLabel ?? oi.gradeLabel;
        orderedQtyM3 = Number(oi.quantityM3);
        if (!plannedQty) plannedQty = Number(oi.quantityM3);
      } else if (!gradeId) {
        const lines = await m.getRepository(OrderItem).find({ where: { orderId } });
        const first = lines[0];
        if (!first) throw badReq('Order has no lines to plan');
        if (lines.length > 1) {
          throw badReq('This order has multiple lines — specify which line (orderItemId) to plan');
        }
        orderItemId = first.id;
        gradeId = first.gradeId;
        gradeLabel = first.gradeLabel;
        orderedQtyM3 = Number(first.quantityM3);
        if (!plannedQty) plannedQty = Number(first.quantityM3);
      }
      // A grade was named directly (no specific line): the ordered quantity is the
      // sum of the order's lines for that grade.
      if (orderedQtyM3 == null && gradeId) {
        const rows: Array<{ sum: string | null }> = await m.query(
          `SELECT COALESCE(SUM(quantity_m3), 0) AS sum FROM order_items WHERE order_id = $1 AND grade_id = $2`,
          [orderId, gradeId],
        );
        orderedQtyM3 = Number(rows[0]?.sum ?? 0);
      }
      // A plan must never schedule more concrete than the order calls for — the
      // planned quantity is what gets batched, and over-production beyond the
      // order is pure waste. An explicit plannedQuantityM3 in the request was
      // previously trusted unchecked, so a plan could enqueue any quantity.
      if (orderedQtyM3 != null && orderedQtyM3 > 0 && plannedQty > orderedQtyM3 + 0.001) {
        throw badReq(`Planned quantity ${plannedQty} m³ exceeds the ordered quantity ${orderedQtyM3} m³ for this grade`);
      }
      const repo = m.getRepository(ProductionPlanItem);
      await repo.save(
        repo.create({
          tenantId, productionPlanId: planId, orderId, orderItemId,
          gradeId, gradeLabel, plannedQuantityM3: String(plannedQty),
          sequenceNo: Number(dto.sequenceNo ?? 0), priority: (dto.priority as string) ?? null,
          status: 'planned',
        }),
      );
      return this.loadFull(m, planId);
    });
  }

  deleteItem(tenantId: string, planId: string, itemId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(ProductionPlanItem);
      const item = await repo.findOne({ where: { id: itemId, productionPlanId: planId } });
      if (!item) throw notFound();
      await repo.delete(itemId);
      return this.loadFull(m, planId);
    });
  }

  setStatus(tenantId: string, id: string, status: string) {
    const allowed = ['draft', 'confirmed', 'in_progress', 'completed', 'cancelled'];
    if (!allowed.includes(status)) throw badReq(`Invalid status ${status}`);
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(ProductionPlan);
      const plan = await repo.findOne({ where: { id } });
      if (!plan) throw notFound();
      if (leavesTerminal(plan.status, status, ['completed', 'cancelled'])) {
        throw badReq(`A ${plan.status} production plan cannot change status`);
      }
      await repo.update(id, { status });
      return this.loadFull(m, id);
    });
  }

  /** Push all planned items to the batch queue (one waiting load each). */
  enqueue(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const plan = await m.getRepository(ProductionPlan).findOne({ where: { id } });
      if (!plan) throw notFound();
      const items = await m.getRepository(ProductionPlanItem).find({ where: { productionPlanId: id } });
      const queueRepo = m.getRepository(BatchQueueEntry);
      const itemRepo = m.getRepository(ProductionPlanItem);
      let queued = 0;
      for (const it of items) {
        if (it.status === 'queued') continue;
        // Idempotency: if this order line already has a live queue entry (from the
        // order path or another plan), skip it — otherwise we double-batch the line
        // and trip uq_batch_queue_order_item. Mirror the order path's dedupe.
        if (it.orderItemId) {
          const existing = await queueRepo.findOne({ where: { orderItemId: it.orderItemId } });
          if (existing && existing.queueStatus !== 'cancelled') {
            await itemRepo.update(it.id, { status: 'queued' });
            continue;
          }
        }
        await queueRepo.save(
          queueRepo.create({
            tenantId, plantId: plan.plantId, orderId: it.orderId, orderItemId: it.orderItemId,
            productionPlanItemId: it.id, gradeId: it.gradeId, gradeLabel: it.gradeLabel,
            plannedQuantityM3: it.plannedQuantityM3, producedQuantityM3: '0', queueStatus: 'waiting',
          }),
        );
        await itemRepo.update(it.id, { status: 'queued' });
        queued++;
      }
      await m.getRepository(ProductionPlan).update(id, { status: 'in_progress' });
      return { plan: await this.loadFull(m, id), queued };
    });
  }
}
