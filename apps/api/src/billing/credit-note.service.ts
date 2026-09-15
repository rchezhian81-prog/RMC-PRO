import { listLimit } from '../common/list-limit.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Company, CreditNote, CreditNoteItem, Customer, Invoice, InvoiceItem } from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { WhatsAppService } from '../sales/whatsapp.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { documentDate } from '../common/business-date.util';
import { isGstin } from '../compliance/gst-payload.util';
import { resolveGstStateCode } from '@rmc/shared';
import { companyBlock, type CreditNotePdfData } from '../sales/pdf.service';
import { creditNoteShareMessage } from '../common/share-messages.util';
import { invoiceBalanceAfter } from './receipt-allocation.util';
import { round2 } from './tax.util';
import { computeNoteLines, creditHeadroom, noteTotals, NOTE_REASONS, NOTE_TYPES, type NoteLineInput, type NoteType } from './credit-note.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Credit / debit note not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const label = (t: string) => (t === 'debit' ? 'Debit note' : 'Credit note');

/**
 * GST credit and debit notes (CGST Rule 53) against issued invoices.
 *
 * A draft is created from an invoice, carrying its party, GSTIN, place of
 * supply and tax treatment; its lines are taxed the way the invoice's were.
 * Issuing draws the number and moves the invoice's balance — through the one
 * balance formula every receipt uses, so the next receipt cannot undo it.
 * Cancelling an issued note reverses that and keeps the number, which GST
 * wants declared rather than missing.
 */
@Injectable()
export class CreditNoteService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly whatsapp: WhatsAppService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, status?: string, limit?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(CreditNote).find({ where: status ? { status } : {}, order: { createdAt: 'DESC' }, take: listLimit(limit) }),
    );
  }

  forInvoice(tenantId: string, invoiceId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(CreditNote).find({ where: { invoiceId }, order: { createdAt: 'ASC' } }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const note = await m.getRepository(CreditNote).findOne({ where: { id } });
    if (!note) throw notFound();
    const items = await m.getRepository(CreditNoteItem).find({ where: { creditNoteId: id }, order: { createdAt: 'ASC' } });
    return { ...note, items, reasonLabel: note.reason ? (NOTE_REASONS[note.reason] ?? note.reason) : null };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  /** The reasons a note can carry, for the screen's list. */
  reasons() {
    return Object.entries(NOTE_REASONS).map(([value, text]) => ({ value, label: text }));
  }

  async create(tenantId: string, dto: Record<string, unknown>, userId: string | null = null) {
    const noteType = String(dto.noteType ?? 'credit') as NoteType;
    if (!NOTE_TYPES.includes(noteType)) throw badReq('noteType must be credit or debit');
    const invoiceId = String(dto.invoiceId ?? '');
    if (!invoiceId) throw badReq('invoiceId required');
    const reason = String(dto.reason ?? '').trim();
    if (!reason) throw badReq('A reason is required — it prints on the note and the auditor will ask for it.');
    const rawLines = Array.isArray(dto.lines) ? (dto.lines as NoteLineInput[]) : [];
    if (!rawLines.length) throw badReq('At least one line is required.');
    for (const l of rawLines) {
      if (num(l.quantity) <= 0 || num(l.rate) <= 0) throw badReq('Every line needs a quantity and a rate above zero.');
    }
    return this.db.runInTenant(tenantId, async (m) => {
      const invoice = await m.getRepository(Invoice).findOne({ where: { id: invoiceId } });
      if (!invoice) throw badReq('Invoice not found');
      if (invoice.invoiceStatus !== 'issued') throw badReq(`A ${label(noteType).toLowerCase()} can only be raised against an issued invoice (this one is ${invoice.invoiceStatus}).`);
      const lines = computeNoteLines(rawLines, invoice.isInterstate);
      const totals = noteTotals(lines);
      if (totals.totalAmount <= 0) throw badReq('The note comes to zero.');
      if (noteType === 'credit') {
        const headroom = creditHeadroom(invoice.totalAmount, invoice.creditNoteAmount, invoice.debitNoteAmount);
        if (totals.totalAmount > headroom + 0.001) {
          throw badReq(`This invoice was billed for ₹${headroom.toLocaleString('en-IN', { minimumFractionDigits: 2 })} net of earlier credit notes; a credit note cannot exceed that.`);
        }
      }
      const repo = m.getRepository(CreditNote);
      const note = await repo.save(
        repo.create({
          tenantId, noteType, invoiceId, customerId: invoice.customerId,
          noteDate: documentDate(dto.noteDate),
          reason, remarks: String(dto.remarks ?? '').trim() || null,
          placeOfSupply: invoice.placeOfSupply, gstin: invoice.gstin, isInterstate: invoice.isInterstate,
          taxableAmount: String(totals.taxableAmount), cgstAmount: String(totals.cgstAmount), sgstAmount: String(totals.sgstAmount),
          igstAmount: String(totals.igstAmount), cessAmount: String(totals.cessAmount), roundOff: String(totals.roundOff),
          totalAmount: String(totals.totalAmount), status: 'draft',
        }),
      );
      const itemRepo = m.getRepository(CreditNoteItem);
      for (const l of lines) {
        await itemRepo.save(itemRepo.create({
          tenantId, creditNoteId: note.id, description: l.description, hsnSac: l.hsnSac, uom: l.uom,
          quantity: String(l.quantity), rate: String(l.rate), taxableAmount: String(l.taxableAmount), gstRate: String(l.gstRate),
          cgstRate: String(l.cgstRate), cgstAmount: String(l.cgstAmount), sgstRate: String(l.sgstRate), sgstAmount: String(l.sgstAmount),
          igstRate: String(l.igstRate), igstAmount: String(l.igstAmount), cessRate: String(l.cessRate), cessAmount: String(l.cessAmount),
          lineTotal: String(l.lineTotal),
        }));
      }
      void userId;
      return this.loadFull(m, note.id);
    });
  }

  /** Draw the number and move the invoice's balance. Approver action. */
  async issue(tenantId: string, id: string, userId: string | null = null) {
    const { result, noteNo, noteType, total, invoiceNo } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(CreditNote);
      const note = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!note) throw notFound();
      if (note.status !== 'draft') throw badReq(`${label(note.noteType)} already ${note.status}`);
      const items = await m.getRepository(CreditNoteItem).find({ where: { creditNoteId: id } });
      const missingHsn = items.filter((it) => !(it.hsnSac ?? '').trim());
      if (missingHsn.length) throw badReq(`Every line needs an HSN/SAC before issuing (${missingHsn.length} missing) — a GST note carries it like the invoice.`);
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];
      if (!isGstin(company?.gstin)) throw badReq('Your company GSTIN is missing or not valid — set it in Settings → Company before issuing GST documents.');
      const invoiceRepo = m.getRepository(Invoice);
      const invoice = await invoiceRepo.findOne({ where: { id: note.invoiceId }, lock: { mode: 'pessimistic_write' } });
      if (!invoice) throw badReq('Invoice not found');
      if (invoice.invoiceStatus !== 'issued') throw badReq(`The invoice is ${invoice.invoiceStatus}; a note can only be issued against an issued invoice.`);
      const total = num(note.totalAmount);
      const credited = num(invoice.creditNoteAmount) + (note.noteType === 'credit' ? total : 0);
      const debited = num(invoice.debitNoteAmount) + (note.noteType === 'debit' ? total : 0);
      if (note.noteType === 'credit' && total > creditHeadroom(invoice.totalAmount, invoice.creditNoteAmount, invoice.debitNoteAmount) + 0.001) {
        throw badReq('Earlier credit notes have used up what this invoice can be credited for.');
      }
      const balance = invoiceBalanceAfter(invoice.totalAmount, invoice.amountPaid, invoice.writtenOffAmount, { credited, debited });
      if (balance.outstanding < -0.001) {
        // The customer has paid more than the invoice now comes to. The money
        // is theirs; the ledger must say so rather than carry a negative.
        throw badReq(
          `After this credit note the customer would have overpaid by ₹${(-balance.outstanding).toLocaleString('en-IN', { minimumFractionDigits: 2 })}. ` +
            'Reverse or reduce the receipt first, or credit only what is still outstanding.',
        );
      }
      const noteNo = note.noteNo ?? (await this.numbering.next(m, tenantId, note.noteType === 'credit' ? 'credit_note' : 'debit_note', note.noteType === 'credit' ? 'CN-' : 'DN-'));
      await repo.update(id, { status: 'issued', noteNo });
      await invoiceRepo.update(invoice.id, {
        creditNoteAmount: String(round2(credited)), debitNoteAmount: String(round2(debited)),
        outstandingAmount: String(balance.outstanding), paymentStatus: balance.paymentStatus,
      });
      return { result: await this.loadFull(m, id), noteNo, noteType: note.noteType, total, invoiceNo: invoice.invoiceNo };
    });
    await this.audit.record({
      tenantId, actorUserId: userId,
      action: noteType === 'credit' ? AUDIT_ACTIONS.CREDIT_NOTE_ISSUE : AUDIT_ACTIONS.DEBIT_NOTE_ISSUE,
      entityType: 'credit_note', entityId: id, entityLabel: noteNo,
      summary: `Issued ${label(noteType).toLowerCase()} ${noteNo} (₹${total}) against invoice ${invoiceNo ?? ''}`.trim(),
      details: { totalAmount: total, invoiceNo },
    });
    return result;
  }

  /** A draft simply goes; an issued note gives the invoice its balance back and keeps its number. */
  async cancel(tenantId: string, id: string, userId: string | null, reason?: string) {
    const { result, noteNo, noteType, total, wasIssued } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(CreditNote);
      const note = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!note) throw notFound();
      if (note.status === 'cancelled') throw badReq(`${label(note.noteType)} already cancelled`);
      const wasIssued = note.status === 'issued';
      if (wasIssued) {
        const invoiceRepo = m.getRepository(Invoice);
        const invoice = await invoiceRepo.findOne({ where: { id: note.invoiceId }, lock: { mode: 'pessimistic_write' } });
        if (!invoice) throw badReq('Invoice not found');
        const total = num(note.totalAmount);
        const credited = round2(num(invoice.creditNoteAmount) - (note.noteType === 'credit' ? total : 0));
        const debited = round2(num(invoice.debitNoteAmount) - (note.noteType === 'debit' ? total : 0));
        const balance = invoiceBalanceAfter(invoice.totalAmount, invoice.amountPaid, invoice.writtenOffAmount, { credited, debited });
        if (balance.outstanding < -0.001) {
          throw badReq('Receipts have been allocated against this debit note; reverse them before cancelling it.');
        }
        await invoiceRepo.update(invoice.id, {
          creditNoteAmount: String(Math.max(0, credited)), debitNoteAmount: String(Math.max(0, debited)),
          outstandingAmount: String(balance.outstanding), paymentStatus: balance.paymentStatus,
        });
      }
      await repo.update(id, { status: 'cancelled', cancelReason: reason?.trim() || null });
      return { result: await this.loadFull(m, id), noteNo: note.noteNo, noteType: note.noteType, total: num(note.totalAmount), wasIssued };
    });
    if (wasIssued) {
      await this.audit.record({
        tenantId, actorUserId: userId, action: AUDIT_ACTIONS.CREDIT_NOTE_CANCEL,
        entityType: 'credit_note', entityId: id, entityLabel: noteNo,
        summary: `Cancelled ${label(noteType).toLowerCase()} ${noteNo ?? ''} (₹${total})${reason ? ` — ${reason}` : ''}`.trim(),
        details: { reason: reason ?? null, totalAmount: total },
      });
    }
    return result;
  }

  async pdfData(tenantId: string, id: string): Promise<{ data: CreditNotePdfData; noteNo: string }> {
    return this.db.runInTenant(tenantId, async (m) => {
      const full = await this.loadFull(m, id);
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];
      const invoice = await m.getRepository(Invoice).findOne({ where: { id: full.invoiceId } });
      const customer = full.customerId ? await m.getRepository(Customer).findOne({ where: { id: full.customerId } }) : null;
      const joinAddress = (...parts: (string | null | undefined)[]) => parts.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ') || null;
      const data: CreditNotePdfData = {
        ...companyBlock(company),
        noteType: full.noteType === 'debit' ? 'debit' : 'credit',
        noteNo: full.noteNo ?? 'DRAFT',
        noteDate: full.noteDate,
        status: full.status,
        invoiceNo: invoice?.invoiceNo ?? null,
        invoiceDate: invoice?.invoiceDate ?? null,
        reason: full.reasonLabel,
        remarks: full.remarks,
        customerName: customer?.customerName ?? 'Customer',
        customerAddress: joinAddress(invoice?.billingAddress ?? customer?.billingAddress, customer?.city, customer?.state, customer?.pincode),
        customerGstin: full.gstin,
        placeOfSupply: full.placeOfSupply,
        placeOfSupplyCode: resolveGstStateCode(full.placeOfSupply) || null,
        isInterstate: full.isInterstate,
        items: full.items.map((it) => ({
          description: it.description ?? '', hsnSac: it.hsnSac ?? '', uom: it.uom ?? '', quantity: it.quantity, rate: it.rate,
          taxableAmount: it.taxableAmount, gstRate: it.gstRate, cgstAmount: it.cgstAmount, sgstAmount: it.sgstAmount, igstAmount: it.igstAmount, lineTotal: it.lineTotal,
        })),
        taxableAmount: full.taxableAmount, cgstAmount: full.cgstAmount, sgstAmount: full.sgstAmount, igstAmount: full.igstAmount,
        cessAmount: full.cessAmount, roundOff: full.roundOff, totalAmount: full.totalAmount,
      };
      return { data, noteNo: full.noteNo ?? 'DRAFT' };
    });
  }

  async share(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const full = await this.loadFull(m, id);
      if (full.status === 'draft') throw badReq('Issue the note before sharing it — a draft has no number yet.');
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];
      const invoice = await m.getRepository(Invoice).findOne({ where: { id: full.invoiceId } });
      const customer = full.customerId ? await m.getRepository(Customer).findOne({ where: { id: full.customerId } }) : null;
      const mobile = (dto.mobile as string) ?? customer?.mobile ?? null;
      const message = (dto.message as string) ?? creditNoteShareMessage({
        companyName: company?.companyName ?? 'Your supplier', noteType: full.noteType === 'debit' ? 'debit' : 'credit', noteNo: full.noteNo ?? '',
        noteDate: full.noteDate, invoiceNo: invoice?.invoiceNo ?? null, totalAmount: full.totalAmount, reason: full.reasonLabel, status: full.status,
      });
      return this.whatsapp.logWithin(m, tenantId, {
        recipientMobile: mobile, moduleKey: 'billing', eventKey: full.noteType === 'debit' ? 'debit_note_share' : 'credit_note_share',
        referenceType: 'credit_note', referenceId: id, message,
      });
    });
  }

  /** Anything live against an invoice blocks cancelling the invoice. */
  static async liveNoteCount(m: EntityManager, invoiceId: string): Promise<number> {
    return m.getRepository(CreditNote).count({ where: [{ invoiceId, status: 'issued' }, { invoiceId, status: 'draft' }] });
  }

  /** Items of a note, for the invoice's own screen. */
  async items(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => m.getRepository(CreditNoteItem).find({ where: { creditNoteId: id } }));
  }

  /** The invoice's lines, for prefilling a credit note on the screen. */
  invoiceLines(tenantId: string, invoiceId: string) {
    return this.db.runInTenant(tenantId, (m) => m.getRepository(InvoiceItem).find({ where: { invoiceId }, order: { createdAt: 'ASC' } }));
  }
}
