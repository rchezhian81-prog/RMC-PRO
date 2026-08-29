import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  BatchTicket,
  Dispatch,
  DeliveryStatusHistory,
  Order,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { recordDeliveryHistory } from './delivery-history.util';
import { buildCycleTimes } from './dispatch-cycle.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Dispatch not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/** Valid dispatch-board statuses and the timestamp each transition stamps. */
const DISPATCH_STATUSES = [
  'waiting', 'loaded', 'left_plant', 'reached_site', 'pouring',
  'completed', 'returning', 'delayed', 'rejected', 'cancelled',
];
const STAMP: Record<string, keyof Dispatch> = {
  left_plant: 'dispatchTime',
  reached_site: 'siteArrivalTime',
  pouring: 'pourStartTime',
  completed: 'pourEndTime',
};

/**
 * Dispatch board (DEV-PLAN B10). Creates a dispatch from a CONFIRMED batch
 * ticket and moves it across the board, stamping the relevant timestamp and
 * recording delivery_status_history on each transition.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(Dispatch).find({
        where: status ? { dispatchStatus: status } : {},
        order: { createdAt: 'DESC' },
      }),
    );
  }

  /**
   * Delivery cycle-time report — travel / on-site wait / pour / turnaround from
   * the timestamps each completed dispatch stamps, over [from, to] on the
   * dispatch date. RLS scopes it to the tenant.
   */
  cycleTimeReport(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.query(
        `SELECT dispatch_no AS "dispatchNo", grade_label AS "gradeLabel",
                dispatch_time AS "dispatchTime", site_arrival_time AS "siteArrivalTime",
                pour_start_time AS "pourStartTime", pour_end_time AS "pourEndTime"
           FROM dispatches
          WHERE dispatch_status = 'completed'
            AND ($1::date IS NULL OR COALESCE(dispatch_time, created_at)::date >= $1::date)
            AND ($2::date IS NULL OR COALESCE(dispatch_time, created_at)::date <= $2::date)
          ORDER BY COALESCE(dispatch_time, created_at) DESC`,
        [from ?? null, to ?? null],
      );
      return buildCycleTimes(rows);
    });
  }

  private async loadFull(m: EntityManager, id: string) {
    const dispatch = await m.getRepository(Dispatch).findOne({ where: { id } });
    if (!dispatch) throw notFound();
    const history = await m
      .getRepository(DeliveryStatusHistory)
      .find({ where: { dispatchId: id }, order: { createdAt: 'ASC' } });
    return { ...dispatch, history };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  /** Create a dispatch from a confirmed batch ticket (loaded onto a vehicle). */
  createFromBatchTicket(tenantId: string, batchTicketId: string, dto: Record<string, unknown>, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const bt = await m.getRepository(BatchTicket).findOne({ where: { id: batchTicketId } });
      if (!bt) throw badReq('Batch ticket not found');
      if (bt.status !== 'confirmed') throw badReq('Only a confirmed batch ticket can be dispatched');

      // One live dispatch per batch ticket: each dispatch claims the ticket's
      // full batched quantity, so a second one would double the delivered (and
      // billable) volume for concrete that was batched once. A cancelled/rejected
      // dispatch frees the ticket to be dispatched again.
      const priorDispatches = await m.getRepository(Dispatch).find({ where: { batchTicketId } });
      if (priorDispatches.some((d) => !['cancelled', 'rejected'].includes(d.dispatchStatus))) {
        throw badReq('This batch ticket is already dispatched');
      }

      let customerId: string | null = null;
      let siteId: string | null = null;
      if (bt.orderId) {
        const order = await m.getRepository(Order).findOne({ where: { id: bt.orderId } });
        customerId = order?.customerId ?? null;
        siteId = order?.siteId ?? null;
      }

      const dispatchNo = await this.numbering.next(m, tenantId, 'dispatch', 'DISP-');
      const repo = m.getRepository(Dispatch);
      const dispatch = await repo.save(
        repo.create({
          tenantId, dispatchNo, plantId: bt.plantId, orderId: bt.orderId, batchTicketId,
          customerId, siteId,
          vehicleId: (dto.vehicleId as string) ?? null,
          driverId: (dto.driverId as string) ?? null,
          gradeId: bt.gradeId, gradeLabel: bt.gradeLabel,
          quantityM3: bt.batchQuantityM3,
          dispatchStatus: 'loaded',
        }),
      );
      await recordDeliveryHistory(m, tenantId, { dispatchId: dispatch.id }, null, 'loaded', userId, 'Dispatch created from batch ticket');
      return this.loadFull(m, dispatch.id);
    });
  }

  /** Advance the dispatch board status, stamping timestamps + history. */
  setStatus(tenantId: string, id: string, status: string, userId: string, dto: Record<string, unknown> = {}) {
    if (!DISPATCH_STATUSES.includes(status)) throw badReq(`Invalid dispatch status ${status}`);
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Dispatch);
      const dispatch = await repo.findOne({ where: { id } });
      if (!dispatch) throw notFound();
      if (['completed', 'cancelled', 'rejected'].includes(dispatch.dispatchStatus)) {
        throw badReq(`Dispatch is ${dispatch.dispatchStatus} and cannot change`);
      }
      const patch: Record<string, unknown> = { dispatchStatus: status };
      const stampField = STAMP[status];
      if (stampField) patch[stampField] = new Date();
      if (status === 'delayed' && dto.delayReason) patch.delayReason = dto.delayReason;
      if (status === 'returning' && dto.returnQuantityM3 !== undefined) patch.returnQuantityM3 = String(dto.returnQuantityM3);
      if (status === 'returning' && dto.returnReason) patch.returnReason = dto.returnReason;
      await repo.update(id, patch);
      await recordDeliveryHistory(m, tenantId, { dispatchId: id }, dispatch.dispatchStatus, status, userId, (dto.note as string) ?? null);
      return this.loadFull(m, id);
    });
  }
}
