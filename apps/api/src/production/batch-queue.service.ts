import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { leavesTerminal } from '../common/state-machine.util';
import { BatchQueueEntry, Order, OrderItem } from '../core/database/entities';
import { listLimit } from '../common/list-limit.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Queue entry not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/** Batch queue — loads waiting for batching (Design Doc 6 §10.3). */
@Injectable()
export class BatchQueueService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * The queue with what a batching operator reads it by: the order and the
   * customer and site behind each load, when the pour is needed, and how many
   * tickets have been raised against it (and how many are still draft). Two
   * batched lookups for the whole page.
   */
  list(tenantId: string, status?: string, limit?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.getRepository(BatchQueueEntry).find({
        where: status ? { queueStatus: status } : {},
        order: { createdAt: 'DESC' },
        take: listLimit(limit),
      });
      const orderIds = [...new Set(rows.map((r) => r.orderId).filter((v): v is string => !!v))];
      const ids = rows.map((r) => r.id);
      const orders: Array<{ id: string; orderNo: string; requiredDatetime: Date | null; customerName: string | null; siteName: string | null }> = orderIds.length
        ? await m.query(
            `SELECT o.id, o.order_no AS "orderNo", o.required_datetime AS "requiredDatetime",
                    c.customer_name AS "customerName", s.site_name AS "siteName"
               FROM orders o
               LEFT JOIN customers c ON c.id = o.customer_id
               LEFT JOIN sites s ON s.id = o.site_id
              WHERE o.id = ANY($1)`,
            [orderIds],
          )
        : [];
      const tickets: Array<{ batchQueueId: string; tickets: number; drafts: number; lastTicketNo: string | null }> = ids.length
        ? await m.query(
            `SELECT batch_queue_id AS "batchQueueId",
                    COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS "tickets",
                    COUNT(*) FILTER (WHERE status = 'draft')::int AS "drafts",
                    (ARRAY_AGG(batch_ticket_no ORDER BY created_at DESC) FILTER (WHERE status <> 'cancelled'))[1] AS "lastTicketNo"
               FROM batch_tickets WHERE batch_queue_id = ANY($1) GROUP BY batch_queue_id`,
            [ids],
          )
        : [];
      const order = new Map(orders.map((o) => [o.id, o]));
      const stat = new Map(tickets.map((t) => [t.batchQueueId, t]));
      return rows.map((r) => {
        const o = r.orderId ? order.get(r.orderId) : undefined;
        const t = stat.get(r.id);
        return {
          ...r,
          orderNo: o?.orderNo ?? null,
          requiredDatetime: o?.requiredDatetime ?? null,
          customerName: o?.customerName ?? null,
          siteName: o?.siteName ?? null,
          tickets: t?.tickets ?? 0,
          drafts: t?.drafts ?? 0,
          lastTicketNo: t?.lastTicketNo ?? null,
        };
      });
    });
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const row = await m.getRepository(BatchQueueEntry).findOne({ where: { id } });
      if (!row) throw notFound();
      return row;
    });
  }

  /** Enqueue a CONFIRMED order — one waiting load per order line. */
  enqueueFromOrder(tenantId: string, orderId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const order = await m.getRepository(Order).findOne({ where: { id: orderId } });
      if (!order) throw badReq('Order not found');
      if (order.orderStatus !== 'confirmed') throw badReq('Only a confirmed order can be sent to the batch queue');
      const items = await m.getRepository(OrderItem).find({ where: { orderId } });
      if (!items.length) throw badReq('Order has no lines');

      const repo = m.getRepository(BatchQueueEntry);
      const created: BatchQueueEntry[] = [];
      for (const it of items) {
        // Idempotency: skip a line that already has a live queue entry. Calling
        // this twice (or via both the order path and a production plan) would
        // otherwise create duplicate loads — double batching, double consumption
        // and double dispatchable volume. A cancelled entry frees it to re-queue.
        const existing = await repo.findOne({ where: { orderItemId: it.id } });
        if (existing && existing.queueStatus !== 'cancelled') continue;
        created.push(
          await repo.save(
            repo.create({
              tenantId, plantId: order.plantId, orderId, orderItemId: it.id,
              gradeId: it.gradeId, gradeLabel: it.gradeLabel,
              plannedQuantityM3: it.quantityM3, producedQuantityM3: '0', queueStatus: 'waiting',
            }),
          ),
        );
      }
      return created;
    });
  }

  setStatus(tenantId: string, id: string, status: string) {
    const allowed = ['waiting', 'batching', 'completed', 'held', 'cancelled'];
    if (!allowed.includes(status)) throw badReq(`Invalid status ${status}`);
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(BatchQueueEntry);
      const row = await repo.findOne({ where: { id } });
      if (!row) throw notFound();
      // A completed queue entry has produced its batch; a cancelled one is void.
      // Re-opening either would let the same load be batched again.
      if (leavesTerminal(row.queueStatus, status, ['completed', 'cancelled'])) {
        throw badReq(`A ${row.queueStatus} queue entry cannot change status`);
      }
      await repo.update(id, { queueStatus: status });
      return repo.findOne({ where: { id } });
    });
  }
}
