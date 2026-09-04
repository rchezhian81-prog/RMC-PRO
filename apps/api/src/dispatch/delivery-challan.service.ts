import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  Company,
  Customer,
  DeliveryChallan,
  DeliveryStatusHistory,
  Dispatch,
  Driver,
  Invoice,
  InvoiceChallan,
  OrderItem,
  Site,
  Vehicle,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { WhatsAppService } from '../sales/whatsapp.service';
import type { ChallanPdfData } from '../sales/pdf.service';
import { recordDeliveryHistory } from './delivery-history.util';
import { returnCost, wastageSummary, type WastageRow } from './wastage.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Challan not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/**
 * Delivery challan (DEV-PLAN B10). Generated from a dispatch with reserved
 * numbering, moved draft → issued → delivered, printed as PDF and shared over
 * WhatsApp. Invoicing (invoice_status) is a later sprint — challans stay
 * not_invoiced here.
 */
@Injectable()
export class DeliveryChallanService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(DeliveryChallan).find({
        where: status ? { challanStatus: status } : {},
        order: { createdAt: 'DESC' },
      }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const challan = await m.getRepository(DeliveryChallan).findOne({ where: { id } });
    if (!challan) throw notFound();
    const history = await m
      .getRepository(DeliveryStatusHistory)
      .find({ where: { challanId: id }, order: { createdAt: 'ASC' } });
    return { ...challan, history };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  /** Generate a challan from a dispatch (one active challan per dispatch). */
  createFromDispatch(tenantId: string, dispatchId: string, dto: Record<string, unknown>, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const dispatch = await m.getRepository(Dispatch).findOne({ where: { id: dispatchId } });
      if (!dispatch) throw badReq('Dispatch not found');
      if (['cancelled', 'rejected'].includes(dispatch.dispatchStatus)) {
        throw badReq(`Dispatch is ${dispatch.dispatchStatus}`);
      }
      const existing = await m
        .getRepository(DeliveryChallan)
        .findOne({ where: { dispatchId } });
      if (existing && existing.challanStatus !== 'cancelled') {
        throw badReq('A challan already exists for this dispatch');
      }

      // Required slump defaults to the order line's spec (matched by grade) so
      // it flows order → challan without re-keying; an explicit dto.slump wins.
      let slump: string | null = (dto.slump as string) ?? null;
      if (slump == null && dispatch.orderId) {
        const line = await m.getRepository(OrderItem).findOne({
          where: dispatch.gradeId
            ? { orderId: dispatch.orderId, gradeId: dispatch.gradeId }
            : { orderId: dispatch.orderId },
        });
        slump = line?.slumpRequired ?? null;
      }

      const challanNo = await this.numbering.next(m, tenantId, 'delivery_challan', 'DC-');
      const repo = m.getRepository(DeliveryChallan);
      const challan = await repo.save(
        repo.create({
          tenantId, challanNo, plantId: dispatch.plantId, dispatchId,
          orderId: dispatch.orderId, batchTicketId: dispatch.batchTicketId,
          customerId: dispatch.customerId, siteId: dispatch.siteId,
          vehicleId: dispatch.vehicleId, driverId: dispatch.driverId,
          gradeId: dispatch.gradeId, gradeLabel: dispatch.gradeLabel,
          quantityM3: dispatch.quantityM3, slump,
          dispatchTime: dispatch.dispatchTime ?? new Date(),
          invoiceStatus: 'not_invoiced', challanStatus: 'draft',
        }),
      );
      await recordDeliveryHistory(m, tenantId, { challanId: challan.id }, null, 'draft', userId, 'Challan generated');
      return this.loadFull(m, challan.id);
    });
  }

  private transition(tenantId: string, id: string, from: string[], to: string, userId: string, patch: Record<string, unknown> = {}) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(DeliveryChallan);
      const challan = await repo.findOne({ where: { id } });
      if (!challan) throw notFound();
      if (!from.includes(challan.challanStatus)) {
        throw badReq(`Cannot move challan from ${challan.challanStatus} to ${to}`);
      }
      await repo.update(id, { challanStatus: to, ...patch });
      await recordDeliveryHistory(m, tenantId, { challanId: id }, challan.challanStatus, to, userId, (patch.note as string) ?? null);
      return this.loadFull(m, id);
    });
  }

  /**
   * A challan can only move forward while its dispatch is still live. If the load
   * was rejected on site (or the dispatch cancelled) after the challan was
   * drafted, issuing or delivering it would bill concrete that the wastage report
   * already writes off as a rejected/cancelled load — the same load counted twice
   * (delivered in the register AND wasted). Block it here; the operator cancels
   * the challan instead. A challan with no dispatch (manual/ad-hoc) is unaffected.
   */
  private async assertDispatchLive(m: EntityManager, challan: DeliveryChallan) {
    if (!challan.dispatchId) return;
    const dispatch = await m.getRepository(Dispatch).findOne({ where: { id: challan.dispatchId } });
    if (dispatch && ['rejected', 'cancelled'].includes(dispatch.dispatchStatus)) {
      throw badReq(`Dispatch is ${dispatch.dispatchStatus} — cancel this challan instead of delivering it`);
    }
  }

  issue(tenantId: string, id: string, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(DeliveryChallan);
      const challan = await repo.findOne({ where: { id } });
      if (!challan) throw notFound();
      if (challan.challanStatus !== 'draft') {
        throw badReq(`Cannot move challan from ${challan.challanStatus} to issued`);
      }
      await this.assertDispatchLive(m, challan);
      await repo.update(id, { challanStatus: 'issued' });
      await recordDeliveryHistory(m, tenantId, { challanId: id }, challan.challanStatus, 'issued', userId, null);
      return this.loadFull(m, id);
    });
  }

  /**
   * Mark a challan delivered, capturing any returned / short-load concrete: the
   * returned quantity, why it came back, and its valuation. The cost per m³
   * defaults to the order line's selling rate for this grade when not supplied,
   * so the wasted concrete is costed automatically (Plan B3).
   */
  markDelivered(tenantId: string, id: string, dto: Record<string, unknown>, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(DeliveryChallan);
      const challan = await repo.findOne({ where: { id } });
      if (!challan) throw notFound();
      if (challan.challanStatus !== 'issued') {
        throw badReq(`Cannot move challan from ${challan.challanStatus} to delivered`);
      }
      await this.assertDispatchLive(m, challan);

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
      await recordDeliveryHistory(m, tenantId, { challanId: id }, challan.challanStatus, 'delivered', userId, (dto.note as string) ?? null);

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
          await recordDeliveryHistory(m, tenantId, { dispatchId: dispatch.id }, dispatch.dispatchStatus, 'completed', userId, 'Auto-completed on challan delivery');
        }
      }
      return this.loadFull(m, id);
    });
  }

  /**
   * Wastage report (Plan B3) — returned / short-load concrete across DELIVERED
   * challans, rolled up by reason and by grade, optionally filtered by date range
   * and plant. Only challans with a positive returned quantity are counted.
   */
  wastageReport(tenantId: string, filters: { from?: string; to?: string; plantId?: string } = {}) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params: unknown[] = [];
      const where: string[] = [`challan_status = 'delivered'`, `return_quantity_m3 > 0`];
      if (filters.from) { params.push(filters.from); where.push(`dispatch_time >= $${params.length}`); }
      if (filters.to) { params.push(filters.to); where.push(`dispatch_time <= $${params.length}`); }
      if (filters.plantId) { params.push(filters.plantId); where.push(`plant_id = $${params.length}`); }

      const returnRows: WastageRow[] = await m.query(
        `SELECT return_quantity_m3 AS "returnQuantityM3",
                return_cost AS "returnCost",
                return_reason AS "returnReason",
                grade_label AS "gradeLabel"
           FROM delivery_challans
          WHERE ${where.join(' AND ')}`,
        params,
      );

      // Whole loads rejected on site or cancelled after batching never reach a
      // challan, but the concrete was produced — so the full batched quantity is
      // wasted. Count it here from the dispatch itself, valued at the order line's
      // rate for the grade (the same basis a returned load is valued at), and
      // bucketed by why it was lost.
      const dParams: unknown[] = [];
      const dWhere: string[] = [`d.dispatch_status IN ('rejected', 'cancelled')`, `d.quantity_m3 > 0`];
      if (filters.from) { dParams.push(filters.from); dWhere.push(`COALESCE(d.dispatch_time, d.created_at) >= $${dParams.length}`); }
      if (filters.to) { dParams.push(filters.to); dWhere.push(`COALESCE(d.dispatch_time, d.created_at) <= $${dParams.length}`); }
      if (filters.plantId) { dParams.push(filters.plantId); dWhere.push(`d.plant_id = $${dParams.length}`); }
      const rejectedRows: WastageRow[] = await m.query(
        `SELECT d.quantity_m3 AS "returnQuantityM3",
                ROUND(d.quantity_m3 * COALESCE(
                  (SELECT oi.rate_per_m3 FROM order_items oi
                    WHERE oi.order_id = d.order_id AND oi.grade_id = d.grade_id
                    LIMIT 1), 0), 2) AS "returnCost",
                CASE d.dispatch_status WHEN 'rejected' THEN 'Rejected load' ELSE 'Cancelled load' END AS "returnReason",
                d.grade_label AS "gradeLabel"
           FROM dispatches d
          WHERE ${dWhere.join(' AND ')}`,
        dParams,
      );

      return wastageSummary([...returnRows, ...rejectedRows]);
    });
  }

  /**
   * Delivery register — delivered challans over a period (net of returns), with
   * the customer and grade. The daily record of concrete supplied, optionally
   * bounded by date and plant.
   */
  deliveryRegister(tenantId: string, filters: { from?: string; to?: string; plantId?: string } = {}) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params: unknown[] = [];
      const where: string[] = [`dc.challan_status = 'delivered'`];
      const dateExpr = `COALESCE(dc.dispatch_time::date, dc.created_at::date)`;
      if (filters.from) { params.push(filters.from); where.push(`${dateExpr} >= $${params.length}`); }
      if (filters.to) { params.push(filters.to); where.push(`${dateExpr} <= $${params.length}`); }
      if (filters.plantId) { params.push(filters.plantId); where.push(`dc.plant_id = $${params.length}`); }

      const rows: Array<{ delivered: number | string }> = await m.query(
        `SELECT dc.challan_no AS "challanNo",
                ${dateExpr} AS date,
                c.customer_name AS "customerName",
                dc.grade_label AS "gradeLabel",
                (dc.quantity_m3 - dc.return_quantity_m3)::float AS delivered
           FROM delivery_challans dc
           LEFT JOIN customers c ON c.id = dc.customer_id
          WHERE ${where.join(' AND ')}
          ORDER BY date DESC, dc.challan_no`,
        params,
      );
      const totalM3 = Math.round(rows.reduce((s, r) => s + (Number(r.delivered) || 0), 0) * 1000) / 1000;
      return { rows, totalM3, count: rows.length };
    });
  }

  cancel(tenantId: string, id: string, userId: string, reason?: string) {
    return this.transition(tenantId, id, ['draft', 'issued'], 'cancelled', userId, { note: reason ?? null });
  }

  async pdfData(tenantId: string, id: string): Promise<{ data: ChallanPdfData; challan: DeliveryChallan }> {
    return this.db.runInTenant(tenantId, async (m) => {
      const challan = await m.getRepository(DeliveryChallan).findOne({ where: { id } });
      if (!challan) throw notFound();
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];
      const customer = challan.customerId ? await m.getRepository(Customer).findOne({ where: { id: challan.customerId } }) : null;
      const site = challan.siteId ? await m.getRepository(Site).findOne({ where: { id: challan.siteId } }) : null;
      const vehicle = challan.vehicleId ? await m.getRepository(Vehicle).findOne({ where: { id: challan.vehicleId } }) : null;
      const driver = challan.driverId ? await m.getRepository(Driver).findOne({ where: { id: challan.driverId } }) : null;
      // If this challan has been invoiced and that invoice has an e-way bill,
      // carry the EWB number onto the dispatch document (runbook 02 §6).
      const link = await m.getRepository(InvoiceChallan).findOne({ where: { challanId: id } });
      const invoice = link ? await m.getRepository(Invoice).findOne({ where: { id: link.invoiceId } }) : null;
      const eway = invoice && invoice.ewayStatus === 'generated' ? invoice : null;
      const data: ChallanPdfData = {
        companyName: company?.companyName ?? 'Company',
        companyGstin: company?.gstin ?? null,
        companyState: company?.state ?? null,
        challanNo: challan.challanNo,
        challanStatus: challan.challanStatus,
        dispatchTime: challan.dispatchTime ? challan.dispatchTime.toISOString().slice(0, 16).replace('T', ' ') : null,
        customerName: customer?.customerName ?? 'Customer',
        siteName: site?.siteName ?? null,
        vehicleNo: vehicle?.vehicleNo ?? null,
        driverName: driver?.driverName ?? null,
        gradeLabel: challan.gradeLabel ?? '',
        quantityM3: challan.quantityM3,
        slump: challan.slump ?? null,
        receiverName: challan.receiverName ?? null,
        ewayBillNo: eway?.ewayBillNo ?? null,
        ewayValidUntil: eway?.ewayValidUntil
          ? new Date(eway.ewayValidUntil).toISOString().replace('T', ' ').slice(0, 16)
          : null,
      };
      return { data, challan };
    });
  }

  async share(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const challan = await m.getRepository(DeliveryChallan).findOne({ where: { id } });
      if (!challan) throw notFound();
      const customer = challan.customerId ? await m.getRepository(Customer).findOne({ where: { id: challan.customerId } }) : null;
      const mobile = (dto.mobile as string) ?? customer?.mobile ?? null;
      const message =
        (dto.message as string) ??
        `Delivery challan ${challan.challanNo}: ${challan.gradeLabel ?? ''} ${challan.quantityM3} m³. Status: ${challan.challanStatus}.`;
      return this.whatsapp.logWithin(m, tenantId, {
        recipientMobile: mobile, moduleKey: 'dispatch', eventKey: 'challan_share',
        referenceType: 'delivery_challan', referenceId: id, message,
      });
    });
  }
}
