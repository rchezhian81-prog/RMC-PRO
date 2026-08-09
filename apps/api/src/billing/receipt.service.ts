import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Customer, Invoice, Payment, PaymentAllocation } from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { WhatsAppService } from '../sales/whatsapp.service';
import { round2 } from './tax.util';

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
      const allocRepo = m.getRepository(PaymentAllocation);
      const paymentRepo = m.getRepository(Payment);

      const payment = await paymentRepo.save(
        paymentRepo.create({
          tenantId, receiptNo, customerId,
          receiptDate: (dto.receiptDate as string) ?? null,
          paymentMode: (dto.paymentMode as string) ?? 'cash',
          amount: String(amount), bankReference: (dto.bankReference as string) ?? null,
          remarks: (dto.remarks as string) ?? null, status: 'posted',
        }),
      );

      let allocated = 0;
      for (const a of allocations) {
        const amt = num(a.amount);
        if (amt <= 0) continue;
        const invoice = await invoiceRepo.findOne({ where: { id: String(a.invoiceId ?? '') } });
        if (!invoice) throw badReq('Invoice not found for allocation');
        if (invoice.invoiceStatus === 'cancelled') throw badReq('Cannot allocate to a cancelled invoice');
        if (invoice.customerId !== customerId) throw badReq('Invoice belongs to a different customer');
        const outstanding = num(invoice.outstandingAmount);
        if (amt > outstanding + 0.001) throw badReq(`Allocation ${amt} exceeds invoice outstanding ${outstanding}`);

        await allocRepo.save(allocRepo.create({ tenantId, paymentId: payment.id, invoiceId: invoice.id, allocatedAmount: String(amt) }));
        const paid = round2(num(invoice.amountPaid) + amt);
        const newOutstanding = round2(num(invoice.totalAmount) - paid);
        await invoiceRepo.update(invoice.id, {
          amountPaid: String(paid), outstandingAmount: String(newOutstanding),
          paymentStatus: newOutstanding <= 0.001 ? 'paid' : 'partially_paid',
        });
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
