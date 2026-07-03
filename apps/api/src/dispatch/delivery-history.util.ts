import type { EntityManager } from 'typeorm';
import { DeliveryStatusHistory } from '../core/database/entities';

/** Append a dispatch/challan status-transition record within a tenant tx. */
export async function recordDeliveryHistory(
  m: EntityManager,
  tenantId: string,
  ref: { dispatchId?: string | null; challanId?: string | null },
  oldStatus: string | null,
  newStatus: string,
  changedBy: string | null,
  note?: string | null,
): Promise<void> {
  const repo = m.getRepository(DeliveryStatusHistory);
  await repo.save(
    repo.create({
      tenantId,
      dispatchId: ref.dispatchId ?? null,
      challanId: ref.challanId ?? null,
      oldStatus,
      newStatus,
      changedBy,
      note: note ?? null,
    }),
  );
}
