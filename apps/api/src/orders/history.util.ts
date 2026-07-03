import type { EntityManager } from 'typeorm';
import { OrderStatusHistory } from '../core/database/entities';

/** Append an immutable order status-transition record within a tenant tx. */
export async function recordHistory(
  m: EntityManager,
  tenantId: string,
  orderId: string,
  fromStatus: string | null,
  toStatus: string,
  action: string,
  actorUserId: string | null,
  note?: string | null,
): Promise<void> {
  const repo = m.getRepository(OrderStatusHistory);
  await repo.save(
    repo.create({ tenantId, orderId, fromStatus, toStatus, action, actorUserId, note: note ?? null }),
  );
}
