import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { CreditHoldRequest, Order } from '../core/database/entities';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { recordHistory } from './history.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Credit hold not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/**
 * Credit-hold approval flow (DEV-PLAN B8, exit criteria "credit-hold approval
 * flow + audit"). Restricted to approvers holding `credit_hold.approve`
 * (enforced at the controller). Every decision is retained on the request row
 * and mirrored into order_status_history.
 */
@Injectable()
export class CreditHoldService {
  constructor(
    private readonly db: TenantDbService,
    private readonly audit: AuditService,
  ) {}

  /** Hold requests with order + customer labels for the approver queue. */
  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) => {
      const qb = m
        .getRepository(CreditHoldRequest)
        .createQueryBuilder('h')
        .leftJoin('orders', 'o', 'o.id = h.order_id')
        .leftJoin('customers', 'c', 'c.id = h.customer_id')
        .select([
          'h.id AS id',
          'h.order_id AS "orderId"',
          'h.customer_id AS "customerId"',
          'h.requested_amount AS "requestedAmount"',
          'h.credit_limit AS "creditLimit"',
          'h.outstanding_before AS "outstandingBefore"',
          'h.exposure_after AS "exposureAfter"',
          'h.reason AS reason',
          'h.status AS status',
          'h.decision_note AS "decisionNote"',
          'h.decided_at AS "decidedAt"',
          'h.created_at AS "createdAt"',
          'o.order_no AS "orderNo"',
          'c.customer_name AS "customerName"',
        ])
        .orderBy('h.created_at', 'DESC');
      if (status) qb.where('h.status = :status', { status });
      return qb.getRawMany();
    });
  }

  private async decide(
    tenantId: string,
    id: string,
    userId: string,
    approve: boolean,
    note?: string,
  ) {
    const { result, orderNo, orderId, amount } = await this.db.runInTenant(tenantId, async (m) => {
      const holdRepo = m.getRepository(CreditHoldRequest);
      const hold = await holdRepo.findOne({ where: { id } });
      if (!hold) throw notFound();
      if (hold.status !== 'pending') throw badReq(`Request already ${hold.status}`);

      const orderRepo = m.getRepository(Order);
      const order = await orderRepo.findOne({ where: { id: hold.orderId } });
      if (!order) throw notFound();

      await holdRepo.update(id, {
        status: approve ? 'approved' : 'rejected',
        decidedBy: userId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      });

      if (approve) {
        await orderRepo.update(order.id, {
          orderStatus: 'confirmed',
          creditStatus: 'approved',
          confirmedBy: userId,
          confirmedAt: new Date(),
        });
        await recordHistory(m, tenantId, order.id, 'credit_hold', 'confirmed', 'credit_approve', userId, note ?? 'Credit hold approved');
      } else {
        await orderRepo.update(order.id, { creditStatus: 'rejected' });
        await recordHistory(m, tenantId, order.id, 'credit_hold', 'credit_hold', 'credit_reject', userId, note ?? 'Credit hold rejected');
      }

      return {
        result: await holdRepo.findOne({ where: { id } }),
        orderNo: order.orderNo,
        orderId: order.id,
        amount: hold.requestedAmount,
      };
    });

    // Recorded after the decision has committed, so a trail failure can never
    // undo an approval or block the approver.
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: approve ? AUDIT_ACTIONS.CREDIT_HOLD_RELEASE : AUDIT_ACTIONS.CREDIT_HOLD_REJECT,
      entityType: 'order',
      entityId: orderId ?? null,
      entityLabel: orderNo ?? null,
      summary: `${approve ? 'Released the credit hold on' : 'Rejected the credit hold for'} order ${orderNo ?? ''} (₹${amount ?? 0})`.trim(),
      details: { note: note ?? null, requestedAmount: amount },
    });
    return result;
  }

  approve(tenantId: string, id: string, userId: string, note?: string) {
    return this.decide(tenantId, id, userId, true, note);
  }

  reject(tenantId: string, id: string, userId: string, note?: string) {
    return this.decide(tenantId, id, userId, false, note);
  }
}
