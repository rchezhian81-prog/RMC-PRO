import { listLimit } from '../common/list-limit.util';
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

/** A plan in one of these is a record of what happened, not a live worksheet. */
const TERMINAL_PLAN_STATUSES: readonly string[] = ['completed', 'cancelled'];

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Plan not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/** Daily production planning (Design Doc 6 §10.1/§10.2). Consumes confirmed orders. */
@Injectable()
export class ProductionPlansService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
  ) {}

  /**
   * The plan list with what a planner reads it by: the plant, how many lines
   * and how much concrete each plan schedules, how many lines have reached
   * the batch queue, and the customers on it. Two batched lookups.
   */
  list(tenantId: string, limit?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.getRepository(ProductionPlan).find({ order: { createdAt: 'DESC' }, take: listLimit(limit) });
      const planIds = rows.map((r) => r.id);
      const plantIds = [...new Set(rows.map((r) => r.plantId).filter((v): v is string => !!v))];
      const plants: Array<{ id: string; plantName: string }> = plantIds.length
        ? await m.query(`SELECT id, plant_name AS "plantName" FROM plants WHERE id = ANY($1)`, [plantIds])
        : [];
      const stats: Array<{ planId: string; lines: number; plannedM3: string; queuedLines: number; customerNames: string[] }> = planIds.length
        ? await m.query(
            `SELECT i.production_plan_id AS "planId",
                    COUNT(*)::int AS lines,
                    COALESCE(SUM(i.planned_quantity_m3), 0)::float AS "plannedM3",
                    COUNT(*) FILTER (WHERE i.status = 'queued')::int AS "queuedLines",
                    ARRAY_REMOVE(ARRAY_AGG(DISTINCT c.customer_name), NULL) AS "customerNames"
               FROM production_plan_items i
               LEFT JOIN orders o ON o.id = i.order_id
               LEFT JOIN customers c ON c.id = o.customer_id
              WHERE i.production_plan_id = ANY($1)
              GROUP BY i.production_plan_id`,
            [planIds],
          )
        : [];
      const plantName = new Map(plants.map((p) => [p.id, p.plantName]));
      const stat = new Map(stats.map((s) => [s.planId, s]));
      return rows.map((r) => {
        const s = stat.get(r.id);
        return {
          ...r,
          plantName: r.plantId ? plantName.get(r.plantId) ?? null : null,
          lines: s?.lines ?? 0,
          plannedM3: Number(s?.plannedM3 ?? 0),
          queuedLines: s?.queuedLines ?? 0,
          customerNames: s?.customerNames ?? [],
        };
      });
    });
  }

  /**
   * One plan with its lines read the way the worksheet shows them: the order
   * and its customer and site, the ordered quantity the line is capped by,
   * and, once queued, where the batch queue has taken it (status, produced).
   */
  private async loadFull(m: EntityManager, id: string) {
    const plan = await m.getRepository(ProductionPlan).findOne({ where: { id } });
    if (!plan) throw notFound();
    const rawItems = await m
      .getRepository(ProductionPlanItem)
      .find({ where: { productionPlanId: id }, order: { sequenceNo: 'ASC', createdAt: 'ASC' } });
    const plant = plan.plantId
      ? ((await m.query(`SELECT plant_name AS "plantName" FROM plants WHERE id = $1`, [plan.plantId])) as Array<{ plantName: string }>)[0] ?? null
      : null;
    const itemIds = rawItems.map((i) => i.id);
    const orderIds = [...new Set(rawItems.map((i) => i.orderId).filter((v): v is string => !!v))];
    const orders: Array<{ id: string; orderNo: string; customerName: string | null; siteName: string | null; requiredDatetime: Date | null }> = orderIds.length
      ? await m.query(
          `SELECT o.id, o.order_no AS "orderNo", c.customer_name AS "customerName", s.site_name AS "siteName", o.required_datetime AS "requiredDatetime"
             FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN sites s ON s.id = o.site_id
            WHERE o.id = ANY($1)`,
          [orderIds],
        )
      : [];
    const lineIds = [...new Set(rawItems.map((i) => i.orderItemId).filter((v): v is string => !!v))];
    const orderLines: Array<{ id: string; quantityM3: string }> = lineIds.length
      ? await m.query(`SELECT id, quantity_m3 AS "quantityM3" FROM order_items WHERE id = ANY($1)`, [lineIds])
      : [];
    const queue: Array<{ itemId: string; queueStatus: string; producedM3: string }> = itemIds.length
      ? await m.query(
          `SELECT DISTINCT ON (production_plan_item_id) production_plan_item_id AS "itemId", queue_status AS "queueStatus", produced_quantity_m3 AS "producedM3"
             FROM batch_queue WHERE production_plan_item_id = ANY($1)
            ORDER BY production_plan_item_id, (queue_status = 'cancelled'), created_at DESC`,
          [itemIds],
        )
      : [];
    const order = new Map(orders.map((o) => [o.id, o]));
    const ordered = new Map(orderLines.map((l) => [l.id, l.quantityM3]));
    const queued = new Map(queue.map((q) => [q.itemId, q]));
    const items = rawItems.map((i) => {
      const o = i.orderId ? order.get(i.orderId) : undefined;
      const q = queued.get(i.id);
      return {
        ...i,
        orderNo: o?.orderNo ?? null,
        customerName: o?.customerName ?? null,
        siteName: o?.siteName ?? null,
        requiredDatetime: o?.requiredDatetime ?? null,
        orderedQtyM3: i.orderItemId ? ordered.get(i.orderItemId) ?? null : null,
        queueStatus: q?.queueStatus ?? null,
        producedM3: q ? Number(q.producedM3) : 0,
      };
    });
    return { ...plan, plantName: plant?.plantName ?? null, items };
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
      // A finished or abandoned plan is a record, not a worksheet.
      if (TERMINAL_PLAN_STATUSES.includes(plan.status)) {
        throw badReq(`A ${plan.status} production plan cannot take new lines`);
      }
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
        // The order LINE is authoritative for the grade. A differing client
        // gradeId used to win, so the plan line (and its queue row) linked the
        // M25 line but carried M40: the M40 mix was batched and the load labelled
        // M40 while invoicing and QC referenced the M25 line.
        if (gradeId && oi.gradeId && String(gradeId) !== String(oi.gradeId)) {
          throw badReq(`gradeId does not match the order line's grade (${oi.gradeLabel ?? oi.gradeId})`);
        }
        gradeId = oi.gradeId ?? gradeId;
        gradeLabel = oi.gradeLabel ?? gradeLabel;
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
        // A grade that is not on the order has nothing to plan against. Read as
        // "ordered 0", it used to skip the over-planning cap below, so unbounded
        // volume could be queued against the order under a grade it never bought.
        if (!(orderedQtyM3 > 0)) throw badReq('This grade is not on the order — nothing to plan for it');
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
      const plan = await m.getRepository(ProductionPlan).findOne({ where: { id: planId } });
      if (!plan) throw notFound();
      if (TERMINAL_PLAN_STATUSES.includes(plan.status)) {
        throw badReq(`A ${plan.status} production plan cannot have lines removed`);
      }
      const repo = m.getRepository(ProductionPlanItem);
      const item = await repo.findOne({ where: { id: itemId, productionPlanId: planId } });
      if (!item) throw notFound();
      // batch_queue.production_plan_item_id REFERENCES production_plan_items(id)
      // with no ON DELETE, so deleting a line that has already been queued raised
      // a raw FK violation (23503) — a 500 that told the operator nothing. The
      // load is on the floor: cancel the queue line first.
      const [queued] = (await m.query(
        `SELECT count(*)::int AS n FROM batch_queue WHERE production_plan_item_id = $1 AND queue_status <> 'cancelled'`,
        [itemId],
      )) as Array<{ n: number }>;
      if (Number(queued?.n ?? 0) > 0) {
        throw badReq('This line is already queued for batching — cancel the queue entry before removing the line.');
      }
      await repo.delete(itemId);
      return this.loadFull(m, planId);
    });
  }

  setStatus(tenantId: string, id: string, status: string) {
    const allowed = ['draft', 'confirmed', 'in_progress', 'completed', 'cancelled'];
    if (!allowed.includes(status)) throw badReq(`Invalid status ${status}`);
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(ProductionPlan);
      // Locked, so the terminal-state check judges the settled row: an unlocked
      // read let a cancel and an enqueue interleave, and whichever wrote last won.
      const plan = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!plan) throw notFound();
      if (leavesTerminal(plan.status, status, ['completed', 'cancelled'])) {
        throw badReq(`A ${plan.status} production plan cannot change status`);
      }
      const res = await repo.update({ id, status: plan.status }, { status });
      if (!res.affected) throw badReq('Production plan changed while updating — reload and retry');
      return this.loadFull(m, id);
    });
  }

  /** Push all planned items to the batch queue (one waiting load each). */
  enqueue(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      // Locked and status-checked. enqueue looked at no status at all and then
      // wrote `in_progress` directly, which walked straight around the terminal
      // guard setStatus enforces: a CANCELLED or COMPLETED plan could be
      // enqueued, pushing its lines onto the batch queue as live loads and
      // bringing the plan back to life. No race needed — cancel, then enqueue.
      const plan = await m.getRepository(ProductionPlan).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!plan) throw notFound();
      if (TERMINAL_PLAN_STATUSES.includes(plan.status)) {
        throw badReq(`A ${plan.status} production plan cannot be queued for batching`);
      }
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
