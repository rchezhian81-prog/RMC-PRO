import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { VendorBill, VendorPayment, VendorPaymentAllocation } from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { billPaymentStatus } from './purchase.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Vendor payment not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;

/**
 * Vendor payments (Plan D2) — money paid to a supplier, allocated across their
 * approved bills. Each allocation reduces a bill's outstanding and advances its
 * payment status. Recording a payment is audited (money out).
 */
@Injectable()
export class VendorPaymentService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) => m.getRepository(VendorPayment).find({ order: { createdAt: 'DESC' } }));
  }

  private async loadFull(m: EntityManager, id: string) {
    const payment = await m.getRepository(VendorPayment).findOne({ where: { id } });
    if (!payment) throw notFound();
    const allocations = await m.getRepository(VendorPaymentAllocation).find({ where: { vendorPaymentId: id } });
    return { ...payment, allocations };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  /** Record a payment to a supplier and allocate it across their approved bills. */
  async create(tenantId: string, dto: Record<string, unknown>, userId: string) {
    const supplierId = String(dto.supplierId ?? '');
    if (!supplierId) throw badReq('supplierId required');
    const amount = num(dto.amount);
    if (amount <= 0) throw badReq('amount must be greater than zero');
    const allocations = Array.isArray(dto.allocations) ? (dto.allocations as Record<string, unknown>[]) : [];

    const { result, paymentNo, allocated } = await this.db.runInTenant(tenantId, async (m) => {
      const paymentNoStr = await this.numbering.next(m, tenantId, 'purchase_payment', 'PAY-');
      const paymentRepo = m.getRepository(VendorPayment);
      const payment = await paymentRepo.save(
        paymentRepo.create({
          tenantId, paymentNo: paymentNoStr, supplierId,
          paymentDate: (dto.paymentDate as string) ?? null,
          paymentMode: (dto.paymentMode as string) ?? 'neft',
          amount: String(amount), bankReference: (dto.bankReference as string) ?? null,
          remarks: (dto.remarks as string) ?? null, status: 'posted',
        }),
      );

      const billRepo = m.getRepository(VendorBill);
      const allocRepo = m.getRepository(VendorPaymentAllocation);
      let allocatedTotal = 0;
      for (const a of allocations) {
        const amt = num(a.amount);
        if (amt <= 0) continue;
        // Lock the bill row: two payments allocating to the same bill concurrently
        // would otherwise each read the same outstanding, both pass the check, and
        // overpay it into a negative outstanding. The lock serializes them.
        const bill = await billRepo.findOne({ where: { id: String(a.billId ?? '') }, lock: { mode: 'pessimistic_write' } });
        if (!bill) throw badReq('Bill not found for allocation');
        if (bill.status !== 'approved') throw badReq('Can only pay an approved bill');
        if (bill.supplierId !== supplierId) throw badReq('Bill belongs to a different supplier');
        const outstanding = round2(num(bill.outstandingAmount));
        if (amt > outstanding + 0.001) throw badReq(`Allocation ${amt} exceeds bill outstanding ${outstanding}`);

        await allocRepo.save(allocRepo.create({ tenantId, vendorPaymentId: payment.id, vendorBillId: bill.id, allocatedAmount: String(amt) }));
        const paid = round2(num(bill.paidAmount) + amt);
        const newOutstanding = round2(num(bill.totalAmount) - paid);
        await billRepo.update(bill.id, {
          paidAmount: String(paid), outstandingAmount: String(newOutstanding),
          paymentStatus: billPaymentStatus(num(bill.totalAmount), paid),
        });
        allocatedTotal = round2(allocatedTotal + amt);
      }

      if (allocatedTotal > amount + 0.001) throw badReq('Allocated more than the payment amount');
      await paymentRepo.update(payment.id, {
        allocatedAmount: String(allocatedTotal), unallocatedAmount: String(round2(amount - allocatedTotal)),
      });
      return { result: await this.loadFull(m, payment.id), paymentNo: paymentNoStr, allocated: allocatedTotal };
    });

    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.VENDOR_PAYMENT_RECORD,
      entityType: 'vendor_payment', entityId: String(result.id), entityLabel: paymentNo,
      summary: `Recorded vendor payment ${paymentNo} (₹${amount}, ₹${allocated} allocated)`.trim(),
      details: { amount, allocated },
    });
    return result;
  }

  /**
   * Reverse a posted payment: unwind each allocation (restore the bill's paid /
   * outstanding / payment status), delete the allocations, and mark the payment
   * `reversed`. A mis-allocated payment could previously never be undone, and the
   * bill it wrongly paid could no longer be cancelled. Reversed payments drop out
   * of the vendor ledger. Audited (money-out correction).
   */
  async reverse(tenantId: string, id: string, userId: string, reason?: string) {
    const { result, paymentNo, amount } = await this.db.runInTenant(tenantId, async (m) => {
      const paymentRepo = m.getRepository(VendorPayment);
      const payment = await paymentRepo.findOne({ where: { id } });
      if (!payment) throw notFound();
      if (payment.status === 'reversed') throw badReq('Payment already reversed');
      if (payment.status !== 'posted') throw badReq(`Cannot reverse a ${payment.status} payment`);

      const allocRepo = m.getRepository(VendorPaymentAllocation);
      const billRepo = m.getRepository(VendorBill);
      const allocations = await allocRepo.find({ where: { vendorPaymentId: id } });
      for (const a of allocations) {
        const bill = await billRepo.findOne({ where: { id: a.vendorBillId }, lock: { mode: 'pessimistic_write' } });
        if (bill) {
          const paid = round2(Math.max(0, num(bill.paidAmount) - num(a.allocatedAmount)));
          await billRepo.update(bill.id, {
            paidAmount: String(paid), outstandingAmount: String(round2(num(bill.totalAmount) - paid)),
            paymentStatus: billPaymentStatus(num(bill.totalAmount), paid),
          });
        }
        await allocRepo.delete({ id: a.id });
      }
      await paymentRepo.update(id, {
        status: 'reversed', allocatedAmount: '0', unallocatedAmount: String(round2(num(payment.amount))),
        remarks: reason ? `Reversed: ${reason}` : payment.remarks,
      });
      return { result: await this.loadFull(m, id), paymentNo: payment.paymentNo, amount: num(payment.amount) };
    });
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.VENDOR_PAYMENT_REVERSE,
      entityType: 'vendor_payment', entityId: id, entityLabel: paymentNo,
      summary: `Reversed vendor payment ${paymentNo} (₹${amount})${reason ? ` — ${reason}` : ''}`,
      details: { amount, reason: reason ?? null },
    });
    return result;
  }

  /**
   * Apply a posted payment's unallocated (advance) amount to approved bills — the
   * path that was missing, so an advance stayed stranded on the payment. Each
   * allocation is bounded by the remaining advance and the bill's outstanding,
   * under a row lock. Audited.
   */
  async applyAdvance(tenantId: string, id: string, allocationsIn: unknown, userId: string) {
    const allocations = Array.isArray(allocationsIn) ? (allocationsIn as Record<string, unknown>[]) : [];
    if (!allocations.length) throw badReq('At least one allocation is required');

    const { result, paymentNo, applied } = await this.db.runInTenant(tenantId, async (m) => {
      const paymentRepo = m.getRepository(VendorPayment);
      const payment = await paymentRepo.findOne({ where: { id } });
      if (!payment) throw notFound();
      if (payment.status !== 'posted') throw badReq(`Cannot apply a ${payment.status} payment`);
      let available = round2(num(payment.unallocatedAmount));
      if (available <= 0.001) throw badReq('This payment has no unallocated amount to apply');

      const billRepo = m.getRepository(VendorBill);
      const allocRepo = m.getRepository(VendorPaymentAllocation);
      let appliedTotal = 0;
      for (const a of allocations) {
        const amt = num(a.amount);
        if (amt <= 0) continue;
        if (amt > available + 0.001) throw badReq(`Allocation ${amt} exceeds the unallocated amount ${available}`);
        const bill = await billRepo.findOne({ where: { id: String(a.billId ?? '') }, lock: { mode: 'pessimistic_write' } });
        if (!bill) throw badReq('Bill not found for allocation');
        if (bill.status !== 'approved') throw badReq('Can only pay an approved bill');
        if (bill.supplierId !== payment.supplierId) throw badReq('Bill belongs to a different supplier');
        const outstanding = round2(num(bill.outstandingAmount));
        if (amt > outstanding + 0.001) throw badReq(`Allocation ${amt} exceeds bill outstanding ${outstanding}`);
        await allocRepo.save(allocRepo.create({ tenantId, vendorPaymentId: id, vendorBillId: bill.id, allocatedAmount: String(amt) }));
        const paid = round2(num(bill.paidAmount) + amt);
        await billRepo.update(bill.id, {
          paidAmount: String(paid), outstandingAmount: String(round2(num(bill.totalAmount) - paid)),
          paymentStatus: billPaymentStatus(num(bill.totalAmount), paid),
        });
        available = round2(available - amt);
        appliedTotal = round2(appliedTotal + amt);
      }
      await paymentRepo.update(id, {
        allocatedAmount: String(round2(num(payment.allocatedAmount) + appliedTotal)),
        unallocatedAmount: String(available),
      });
      return { result: await this.loadFull(m, id), paymentNo: payment.paymentNo, applied: appliedTotal };
    });
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.VENDOR_PAYMENT_RECORD,
      entityType: 'vendor_payment', entityId: id, entityLabel: paymentNo,
      summary: `Applied advance ₹${applied} from vendor payment ${paymentNo}`,
      details: { applied },
    });
    return result;
  }
}
