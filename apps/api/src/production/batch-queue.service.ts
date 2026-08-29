import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { leavesTerminal } from '../common/state-machine.util';
import { BatchQueueEntry, Order, OrderItem } from '../core/database/entities';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Queue entry not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/** Batch queue — loads waiting for batching (Design Doc 6 §10.3). */
@Injectable()
export class BatchQueueService {
  constructor(private readonly db: TenantDbService) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(BatchQueueEntry).find({
        where: status ? { queueStatus: status } : {},
        order: { createdAt: 'DESC' },
      }),
    );
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
