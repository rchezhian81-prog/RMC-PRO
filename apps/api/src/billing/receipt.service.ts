import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Customer, Invoice, Payment, PaymentAllocation } from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { WhatsAppService } from '../sales/whatsapp.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { round2 } from './tax.util';
import { allocateAcrossInvoices, invoiceBalanceAfter } from './receipt-allocation.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Receipt not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Receipts + allocation (DEV-PLAN B12). Records a customer payment and allocates
 * it across issued invoices, updating each invoice's paid / outstanding /
 * payment_status. No payment-gateway collection (manual entry only).
 */
@Injectable()
export class ReceiptService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly whatsapp: WhatsAppService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) => m.getRepository(Payment).find({ order: { createdAt: 'DESC' } }));
  }

  private async loadFull(m: EntityManager, id: string) {
    const payment = await m.getRepository(Payment).findOne({ where: { id } });
    if (!payment) throw notFound();
    const allocations = await m.getRepository(PaymentAllocation).find({ where: { paymentId: id } });
    return { ...payment, allocations };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    const customerId = String(dto.customerId ?? '');
    if (!customerId) throw badReq('customerId required');
    const amount = num(dto.amount);
    if (amount <= 0) throw badReq('amount must be greater than zero');
    const allocations = Array.isArray(dto.allocations) ? (dto.allocations as Record<string, unknown>[]) : [];

    return this.db.runInTenant(tenantId, async (m) => {
      const receiptNo = await this.numbering.next(m, tenantId, 'receipt', 'RCPT-');
      const invoiceRepo = m.getRepository(Invoice);
      const paymentRepo = m.getRepository(Payment);

      const mode = ((dto.paymentMode as string) ?? 'cash').toLowerCase();
      const payment = await paymentRepo.save(
        paymentRepo.create({
          tenantId, receiptNo, customerId,
          receiptDate: (dto.receiptDate as string) ?? null,
          paymentMode: (dto.paymentMode as string) ?? 'cash',
          amount: String(amount), bankReference: (dto.bankReference as string) ?? null,
          remarks: (dto.remarks as string) ?? null, status: 'posted',
          // A cheque is money-in-transit until it clears; other modes are instant.
          clearingStatus: mode === 'cheque' ? 'pending' : 'cleared',
        }),
      );

      let allocated = 0;
      for (const a of allocations) {
        const amt = num(a.amount);
        if (amt <= 0) continue;
        // Lock the invoice row: two receipts allocating to the same invoice
        // concurrently would otherwise both read a stale amountPaid and the
        // second UPDATE would clobber the first (lost receipt / over-payment).
        const invoice = await invoiceRepo.findOne({ where: { id: String(a.invoiceId ?? '') }, lock: { mode: 'pessimistic_write' } });
        if (!invoice) throw badReq('Invoice not found for allocation');
        // Only an issued invoice is a real receivable. A draft carries
        // outstanding = total but was never billed, so allocating to it would
        // mis-state AR and then block the draft from being cancelled.
        if (invoice.invoiceStatus !== 'issued') throw badReq(`Invoice ${invoice.invoiceNo} is not issued`);
        if (invoice.customerId !== customerId) throw badReq('Invoice belongs to a different customer');
        const outstanding = num(invoice.outstandingAmount);
        if (amt > outstanding + 0.001) throw badReq(`Allocation ${amt} exceeds invoice outstanding ${outstanding}`);

        // Settle through the shared helper so a manual allocation honours the
        // invoice's write-off exactly like advance-apply and bounce do.
        await this.creditInvoice(m, tenantId, payment.id, invoice, amt);
        allocated = round2(allocated + amt);
      }

      if (allocated > amount + 0.001) throw badReq('Allocated more than the receipt amount');
      await paymentRepo.update(payment.id, {
        allocatedAmount: String(allocated), unallocatedAmount: String(round2(amount - allocated)),
        isAdvance: allocated === 0,
      });
      return this.loadFull(m, payment.id);
    });
  }

  /** Credit an invoice by `amt`: record the allocation and update its balance. */
  private async creditInvoice(m: EntityManager, tenantId: string, paymentId: string, invoice: Invoice, amt: number) {
    await m.getRepository(PaymentAllocation).save(
      m.getRepository(PaymentAllocation).create({ tenantId, paymentId, invoiceId: invoice.id, allocatedAmount: String(amt) }),
    );
    const paid = round2(num(invoice.amountPaid) + amt);
    const { outstanding, paymentStatus } = invoiceBalanceAfter(invoice.totalAmount, paid, invoice.writtenOffAmount);
    await m.getRepository(Invoice).update(invoice.id, {
      amountPaid: String(paid), outstandingAmount: String(outstanding), paymentStatus,
    });
  }

  /** Mark a pending cheque realised (cleared by the bank). */
  realise(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const payment = await m.getRepository(Payment).findOne({ where: { id } });
      if (!payment) throw notFound();
      if (payment.clearingStatus !== 'pending') throw badReq('Only a pending cheque can be marked realised');
      await m.getRepository(Payment).update(id, { clearingStatus: 'realised' });
      return this.loadFull(m, id);
    });
  }

  /**
   * Bounce a cheque (NSF): reverse every allocation — restoring each invoice's
   * outstanding and payment status — and mark the receipt reversed. Audited.
   */
  async bounce(tenantId: string, id: string, userId: string, reason?: string) {
    const receiptNo = await this.db.runInTenant(tenantId, async (m) => {
      const paymentRepo = m.getRepository(Payment);
      const payment = await paymentRepo.findOne({ where: { id } });
      if (!payment) throw notFound();
      if (payment.status === 'reversed') throw badReq('Receipt is already reversed');
      // Only a cheque bounces (NSF). Guarding on status alone let a cash/UPI
      // receipt be "bounced", silently reversing every allocation.
      if ((payment.paymentMode ?? '').toLowerCase() !== 'cheque') throw badReq('Only a cheque receipt can be bounced.');
      const invoiceRepo = m.getRepository(Invoice);
      const allocRepo = m.getRepository(PaymentAllocation);
      const allocations = await allocRepo.find({ where: { paymentId: id } });
      for (const a of allocations) {
        const invoice = await invoiceRepo.findOne({ where: { id: a.invoiceId }, lock: { mode: 'pessimistic_write' } });
        if (invoice) {
          // Floor at 0 so a data anomaly (amountPaid already below this allocation)
          // can't push outstanding above the invoice total on reversal — the
          // vendor-payment reversal clamps the same way.
          const paid = Math.max(0, round2(num(invoice.amountPaid) - num(a.allocatedAmount)));
          const { outstanding, paymentStatus } = invoiceBalanceAfter(invoice.totalAmount, paid, invoice.writtenOffAmount);
          await invoiceRepo.update(invoice.id, {
            amountPaid: String(paid), outstandingAmount: String(outstanding), paymentStatus,
          });
        }
        await allocRepo.delete(a.id);
      }
      await paymentRepo.update(id, {
        status: 'reversed', clearingStatus: 'bounced',
        allocatedAmount: '0', unallocatedAmount: payment.amount, isAdvance: false,
      });
      return payment.receiptNo;
    });
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.RECEIPT_BOUNCE,
      entityType: 'receipt', entityId: id, entityLabel: receiptNo,
      summary: `Cheque bounced for receipt ${receiptNo}${reason ? ` — ${reason}` : ''}`.trim(),
      details: { reason: reason ?? null },
    });
    return this.get(tenantId, id);
  }

  /** Apply a receipt's unallocated (advance) amount across the customer's oldest open invoices. */
  applyAdvance(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const payment = await m.getRepository(Payment).findOne({ where: { id } });
      if (!payment) throw notFound();
      if (payment.status === 'reversed') throw badReq('A reversed receipt cannot be applied');
      const unallocated = num(payment.unallocatedAmount);
      if (unallocated <= 0.001) throw badReq('Nothing left to apply on this receipt');

      const open: Invoice[] = await m.getRepository(Invoice).find({
        where: { customerId: payment.customerId as string, invoiceStatus: 'issued' },
        order: { invoiceDate: 'ASC', createdAt: 'ASC' },
        // Lock the customer's open invoices so a concurrent receipt allocation
        // can't credit the same invoice from a stale balance.
        lock: { mode: 'pessimistic_write' },
      });
      const lines = allocateAcrossInvoices(
        unallocated,
        open.filter((inv) => num(inv.outstandingAmount) > 0.001).map((inv) => ({ id: inv.id, outstanding: num(inv.outstandingAmount) })),
      );
      let applied = 0;
      for (const l of lines) {
        const invoice = open.find((inv) => inv.id === l.invoiceId)!;
        await this.creditInvoice(m, tenantId, id, invoice, l.amount);
        applied = round2(applied + l.amount);
      }
      if (applied <= 0) throw badReq('No open invoices to apply the advance to');
      const newAllocated = round2(num(payment.allocatedAmount) + applied);
      await m.getRepository(Payment).update(id, {
        allocatedAmount: String(newAllocated),
        unallocatedAmount: String(round2(num(payment.amount) - newAllocated)),
        isAdvance: newAllocated <= 0.001,
      });
      return this.loadFull(m, id);
    });
  }

  async share(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const payment = await m.getRepository(Payment).findOne({ where: { id } });
      if (!payment) throw notFound();
      const customer = payment.customerId ? await m.getRepository(Customer).findOne({ where: { id: payment.customerId } }) : null;
      const mobile = (dto.mobile as string) ?? customer?.mobile ?? null;
      const message = (dto.message as string) ??
        `Receipt ${payment.receiptNo} for ₹${payment.amount} received. Thank you.`;
      return this.whatsapp.logWithin(m, tenantId, {
        recipientMobile: mobile, moduleKey: 'billing', eventKey: 'receipt_share',
        referenceType: 'receipt', referenceId: id, message,
      });
    });
  }
}
