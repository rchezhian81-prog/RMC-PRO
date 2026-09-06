import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DeliveryChallan, Dispatch, InvoiceChallan, OrderItem } from '../core/database/entities';
import { recordDeliveryHistory } from './delivery-history.util';
import { returnCost } from './wastage.util';

const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/**
 * The delivery-challan state machine, shared by EVERY writer — the challan
 * endpoints (issue / deliver / cancel) and offline sync (push + conflict
 * resolution). Before this, sync copied `payload.challanStatus` straight onto the
 * row, bypassing the transition whitelist, the dispatch-live check and the
 * invoiced guard: a rejected load could be marked delivered and invoiced, and an
 * invoiced challan could be "cancelled" (and a second challan raised for the
 * same dispatch). One implementation here, used by both.
 */
export const CHALLAN_STATUSES = ['draft', 'issued', 'delivered', 'cancelled'] as const;
export type ChallanStatus = (typeof CHALLAN_STATUSES)[number];

export const isChallanStatus = (s: unknown): s is ChallanStatus =>
  typeof s === 'string' && (CHALLAN_STATUSES as readonly string[]).includes(s);

/** The only legal moves: draft → issued → delivered; draft/issued → cancelled. */
const NEXT: Record<ChallanStatus, readonly ChallanStatus[]> = {
  draft: ['issued', 'cancelled'],
  issued: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: string, to: ChallanStatus): boolean {
  return isChallanStatus(from) && NEXT[from].includes(to);
}

export function assertTransition(from: string, to: ChallanStatus): void {
  if (!canTransition(from, to)) throw badReq(`Cannot move challan from ${from} to ${to}`);
}

/**
 * A challan can only move forward while its dispatch is still live. If the load
 * was rejected on site (or the dispatch cancelled) after the challan was
 * drafted, issuing or delivering it would bill concrete that the wastage report
 * already writes off as a rejected/cancelled load — the same load counted twice
 * (delivered in the register AND wasted). Block it; the operator cancels the
 * challan instead. A challan with no dispatch (manual/ad-hoc) is unaffected.
 */
export async function assertDispatchLive(m: EntityManager, challan: DeliveryChallan): Promise<void> {
  if (!challan.dispatchId) return;
  const dispatch = await m.getRepository(Dispatch).findOne({ where: { id: challan.dispatchId } });
  if (dispatch && ['rejected', 'cancelled'].includes(dispatch.dispatchStatus)) {
    throw badReq(`Dispatch is ${dispatch.dispatchStatus} — cancel this challan instead of delivering it`);
  }
}

/**
 * An invoiced challan is frozen: its status may not change while an invoice
 * stands on it (cancel the invoice first). Checked on both the denormalised flag
 * and the authoritative invoice_challans link, so a drifted flag cannot let a
 * billed challan be cancelled and re-billed.
 */
export async function assertNotInvoiced(m: EntityManager, challan: DeliveryChallan): Promise<void> {
  if (challan.invoiceStatus === 'invoiced') {
    throw badReq(`Challan ${challan.challanNo} is invoiced — cancel the invoice before changing it`);
  }
  const linked = await m.getRepository(InvoiceChallan).count({ where: { challanId: challan.id } });
  if (linked > 0) throw badReq(`Challan ${challan.challanNo} is linked to an invoice — cancel the invoice before changing it`);
}

/**
 * Deliver an ISSUED challan whose guards have already passed: capture any
 * returned / short-load concrete (explicit value, else what the dispatch board
 * recorded on the `returning` leg), value it (default: the order line's rate for
 * the grade), record the transition, and close the dispatch. This is the body
 * DeliveryChallanService.markDelivered always had — moved here verbatim so
 * offline sync delivers through the same code instead of a raw status write.
 */
export async function deliverChallan(
  m: EntityManager,
  tenantId: string,
  challan: DeliveryChallan,
  dto: Record<string, unknown>,
  changedBy: string | null,
): Promise<void> {
  const repo = m.getRepository(DeliveryChallan);
  const id = challan.id;

  // Returned/short-load concrete. Prefer what the deliverer enters now (an
  // explicit 0 means "nothing came back"); when nothing is supplied, inherit
  // what the dispatch board already recorded on the `returning` leg — that
  // value was previously dropped, so a return captured upstream never reached
  // billing and the customer was billed for concrete they sent back.
  let returnQty = dto.returnQuantityM3 !== undefined ? Number(dto.returnQuantityM3) || 0 : NaN;
  let returnReasonIn = dto.returnReason as string | undefined;
  if (Number.isNaN(returnQty)) {
    const dispatch = challan.dispatchId
      ? await m.getRepository(Dispatch).findOne({ where: { id: challan.dispatchId } })
      : null;
    returnQty = Number(dispatch?.returnQuantityM3 ?? 0) || 0;
    if (returnReasonIn === undefined) returnReasonIn = dispatch?.returnReason ?? undefined;
  }
  // A return can't exceed the load nor be negative — clamp so the delivery
  // register and wastage report can't be driven negative by a bad value.
  returnQty = Math.max(0, Math.min(returnQty, Number(challan.quantityM3) || 0));

  let costPerM3 = dto.returnCostPerM3 !== undefined ? Number(dto.returnCostPerM3) || 0 : 0;
  // Default the valuation to the order line's rate for this grade.
  if (returnQty > 0 && !costPerM3 && challan.orderId) {
    const orderItem = await m.getRepository(OrderItem).findOne({
      where: challan.gradeId ? { orderId: challan.orderId, gradeId: challan.gradeId } : { orderId: challan.orderId },
    });
    costPerM3 = Number(orderItem?.ratePerM3 ?? 0) || 0;
  }
  const returnReason = returnQty > 0 ? (returnReasonIn ?? null) : null;
  const cost = returnQty > 0 ? returnCost(returnQty, costPerM3) : 0;

  await repo.update(id, {
    challanStatus: 'delivered',
    receiverName: (dto.receiverName as string) ?? null,
    returnQuantityM3: String(returnQty),
    returnReason,
    returnCostPerM3: String(returnQty > 0 ? costPerM3 : 0),
    returnCost: String(cost),
  });
  await recordDeliveryHistory(m, tenantId, { challanId: id }, challan.challanStatus, 'delivered', changedBy, (dto.note as string) ?? null);

  // Close the trip: a transit-mixer runs one load per dispatch, so a
  // delivered challan means that dispatch is done. Without this the load
  // lingers on the GPS live board and its cycle time never completes. Only
  // advance a still-open dispatch (skip one already completed/cancelled/
  // rejected) and stamp the pour-end time if the board never did.
  if (challan.dispatchId) {
    const dispatchRepo = m.getRepository(Dispatch);
    const dispatch = await dispatchRepo.findOne({ where: { id: challan.dispatchId } });
    if (dispatch && !['completed', 'cancelled', 'rejected'].includes(dispatch.dispatchStatus)) {
      await dispatchRepo.update(dispatch.id, {
        dispatchStatus: 'completed',
        pourEndTime: dispatch.pourEndTime ?? new Date(),
      });
      await recordDeliveryHistory(m, tenantId, { dispatchId: dispatch.id }, dispatch.dispatchStatus, 'completed', changedBy, 'Auto-completed on challan delivery');
    }
  }
}
