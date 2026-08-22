import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  Company,
  CreditHoldRequest,
  Customer,
  Order,
  OrderItem,
  OrderStatusHistory,
  PourScheduleSlot,
} from '../core/database/entities';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { summariseGst, isInterstateSupply } from '../billing/tax.util';
import { summarisePourSchedule } from './pour-schedule.util';

const num = (v: unknown): number => Number(v ?? 0) || 0;
import { CreditService, type CreditAssessment } from './credit.service';
import { creditExposureValue } from './credit-value.util';
import { attachCustomerName } from '../common/attach-customer-name';
import { recordHistory } from './history.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Order not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/**
 * Order lifecycle (DEV-PLAN B8): confirm a draft (with credit block at booking),
 * cancel, and expose the credit assessment + status history. Confirmed orders
 * hand off to later sprints (production/dispatch) — none of which run here.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: TenantDbService,
    private readonly credit: CreditService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const where = status ? { orderStatus: status } : {};
      const orders = await m.getRepository(Order).find({ where, order: { createdAt: 'DESC' } });
      return attachCustomerName(m, orders);
    });
  }

  private async loadFull(m: EntityManager, id: string) {
    const order = await m.getRepository(Order).findOne({ where: { id } });
    if (!order) throw notFound();
    const items = await m.getRepository(OrderItem).find({ where: { orderId: id }, order: { createdAt: 'ASC' } });
    const history = await m
      .getRepository(OrderStatusHistory)
      .find({ where: { orderId: id }, order: { createdAt: 'ASC' } });
    const holds = await m
      .getRepository(CreditHoldRequest)
      .find({ where: { orderId: id }, order: { createdAt: 'DESC' } });

    const company = (await m.getRepository(Company).find({ take: 1 }))[0];
    const customer = order.customerId
      ? await m.getRepository(Customer).findOne({ where: { id: order.customerId } })
      : null;
    const taxSummary = summariseGst(
      items.map((it) => ({
        quantity: num(it.quantityM3), rate: num(it.ratePerM3),
        transport: num(it.transportCharge), pump: num(it.pumpCharge), waiting: num(it.waitingCharge),
        gstRate: num(it.gstRate),
      })),
      isInterstateSupply(company?.state, customer?.state),
    );

    // Pour schedule + scheduled-vs-delivered (delivered = confirmed batch tickets).
    const pourSlots = await m
      .getRepository(PourScheduleSlot)
      .find({ where: { orderId: id }, order: { slotDate: 'ASC', sequenceNo: 'ASC', createdAt: 'ASC' } });
    const orderedM3 = items.reduce((a, it) => a + num(it.quantityM3), 0);
    const [delivered] = await m.query(
      `SELECT COALESCE(sum(batch_quantity_m3), 0)::float AS m3 FROM batch_tickets WHERE order_id = $1 AND status = 'confirmed'`,
      [id],
    );
    const pourSummary = summarisePourSchedule(
      pourSlots.map((s) => ({ quantityM3: num(s.quantityM3), status: s.status })),
      orderedM3,
      num(delivered?.m3),
    );
    return { ...order, items, history, creditHolds: holds, taxSummary, pourSlots, pourSummary };
  }

  // ---- Pour schedule (Plan B1) -------------------------------------------
  addPourSlot(tenantId: string, orderId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const order = await m.getRepository(Order).findOne({ where: { id: orderId } });
      if (!order) throw notFound();
      const qty = num(dto.quantityM3);
      if (qty <= 0) throw badReq('Slot quantity (m³) must be greater than zero');
      if (!dto.slotDate) throw badReq('Slot date is required');
      const repo = m.getRepository(PourScheduleSlot);
      await repo.save(
        repo.create({
          tenantId, orderId,
          siteId: (dto.siteId as string) || order.siteId || null,
          slotDate: String(dto.slotDate),
          startTime: (dto.startTime as string) || null,
          quantityM3: String(qty),
          truckSpacingMinutes: dto.truckSpacingMinutes ? num(dto.truckSpacingMinutes) : null,
          pumpRequired: dto.pumpRequired === true || dto.pumpRequired === 'true',
          sequenceNo: dto.sequenceNo ? num(dto.sequenceNo) : 0,
          remarks: (dto.remarks as string) || null,
        }),
      );
      return this.loadFull(m, orderId);
    });
  }

  removePourSlot(tenantId: string, orderId: string, slotId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(PourScheduleSlot);
      const slot = await repo.findOne({ where: { id: slotId, orderId } });
      if (!slot) throw notFound();
      await repo.delete(slotId);
      return this.loadFull(m, orderId);
    });
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  /** Preview the credit assessment for a draft order without changing state. */
  creditCheck(tenantId: string, id: string): Promise<CreditAssessment> {
    return this.db.runInTenant(tenantId, async (m) => {
      const order = await m.getRepository(Order).findOne({ where: { id } });
      if (!order) throw notFound();
      return this.credit.assess(
        m, order.customerId,
        creditExposureValue(order.estimatedOrderValueInclGst, order.estimatedOrderValue),
        order.id,
      );
    });
  }

  /** Confirm a draft order; blocks to credit_hold when the limit is breached. */
  confirm(tenantId: string, id: string, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Order);
      const order = await repo.findOne({ where: { id } });
      if (!order) throw notFound();
      if (order.orderStatus !== 'draft') {
        throw badReq(`Only a draft order can be confirmed (current: ${order.orderStatus})`);
      }
      const items = await m.getRepository(OrderItem).find({ where: { orderId: id } });
      if (!items.length) throw badReq('Cannot confirm an order with no lines');

      const a = await this.credit.assess(
        m, order.customerId,
        creditExposureValue(order.estimatedOrderValueInclGst, order.estimatedOrderValue),
        order.id,
      );

      if (a.withinLimit) {
        await repo.update(id, {
          orderStatus: 'confirmed',
          creditStatus: 'approved',
          confirmedBy: userId,
          confirmedAt: new Date(),
        });
        await recordHistory(m, tenantId, id, 'draft', 'confirmed', 'confirm', userId,
          a.enforced ? `Within credit limit (exposure ${a.exposureAfter} / ${a.creditLimit})` : 'No credit limit enforced');
      } else {
        await repo.update(id, { orderStatus: 'credit_hold', creditStatus: 'on_hold' });
        const holdRepo = m.getRepository(CreditHoldRequest);
        await holdRepo.save(
          holdRepo.create({
            tenantId,
            orderId: id,
            customerId: order.customerId,
            requestedAmount: String(a.requestedAmount),
            creditLimit: String(a.creditLimit),
            outstandingBefore: String(a.outstandingBefore),
            exposureAfter: String(a.exposureAfter),
            reason: 'credit_limit_exceeded',
            status: 'pending',
            requestedBy: userId,
          }),
        );
        await recordHistory(m, tenantId, id, 'draft', 'credit_hold', 'credit_hold', userId,
          `Exposure ${a.exposureAfter} exceeds limit ${a.creditLimit}`);
      }
      return this.loadFull(m, id);
    });
  }

  /** Cancel an order (any non-cancelled state); closes any pending hold. */
  async cancel(tenantId: string, id: string, userId: string, reason?: string) {
    const { result, orderNo } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Order);
      const order = await repo.findOne({ where: { id } });
      if (!order) throw notFound();
      if (order.orderStatus === 'cancelled') throw badReq('Order is already cancelled');
      const from = order.orderStatus;
      await repo.update(id, { orderStatus: 'cancelled', cancelledReason: reason ?? null });
      await m
        .getRepository(CreditHoldRequest)
        .update({ orderId: id, status: 'pending' }, { status: 'cancelled', decidedBy: userId, decidedAt: new Date() });
      await recordHistory(m, tenantId, id, from, 'cancelled', 'cancel', userId, reason ?? null);
      return { result: await this.loadFull(m, id), orderNo: order.orderNo, from };
    });
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.ORDER_CANCEL,
      entityType: 'order',
      entityId: id,
      entityLabel: orderNo ?? null,
      summary: `Cancelled order ${orderNo ?? ''}${reason ? ` — ${reason}` : ''}`.trim(),
      details: { reason: reason ?? null },
    });
    return result;
  }
}
