import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Sprint 9 — Billing & payments (Design Doc 6 §13). Invoices are generated from
 * DELIVERED challans; receipts allocate against invoices; outstanding + aging
 * are computed live. E-invoice / e-way-bill fields are stored READY-ONLY (no
 * live GSTN/e-way API — Phase 3). Money columns numeric(16,2).
 *
 * Residual sign-off #1: invoice lines use a GENERIC `quantity` (+ hsn_sac, uom,
 * cess), not quantity_m3.
 */

/** Customer GST invoice header (Doc 6 §13.1) with embedded e-inv/e-way fields. */
@Entity('invoices')
@Unique('uq_invoices_no', ['tenantId', 'invoiceNo'])
export class Invoice extends TenantScopedEntity {
  @Column({ name: 'invoice_no', type: 'varchar' }) invoiceNo!: string;
  @Column({ name: 'invoice_date', type: 'date', nullable: true }) invoiceDate!: string | null;
  @Column({ name: 'due_date', type: 'date', nullable: true }) dueDate!: string | null;
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ name: 'site_id', type: 'uuid', nullable: true }) siteId!: string | null;
  @Column({ name: 'billing_address', type: 'varchar', nullable: true }) billingAddress!: string | null;
  @Column({ name: 'place_of_supply', type: 'varchar', nullable: true }) placeOfSupply!: string | null;
  @Column({ name: 'gstin', type: 'varchar', nullable: true }) gstin!: string | null;
  @Column({ name: 'is_interstate', type: 'boolean', default: false }) isInterstate!: boolean;
  @Column({ name: 'taxable_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) taxableAmount!: string;
  @Column({ name: 'cgst_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) cgstAmount!: string;
  @Column({ name: 'sgst_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) sgstAmount!: string;
  @Column({ name: 'igst_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) igstAmount!: string;
  @Column({ name: 'cess_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) cessAmount!: string;
  @Column({ name: 'round_off', type: 'numeric', precision: 8, scale: 2, default: 0 }) roundOff!: string;
  @Column({ name: 'total_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) totalAmount!: string;
  @Column({ name: 'amount_paid', type: 'numeric', precision: 16, scale: 2, default: 0 }) amountPaid!: string;
  @Column({ name: 'outstanding_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) outstandingAmount!: string;
  @Column({ name: 'written_off_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) writtenOffAmount!: string;
  @Column({ name: 'payment_status', type: 'varchar', default: 'unpaid' }) paymentStatus!: string;
  @Column({ name: 'invoice_status', type: 'varchar', default: 'draft' }) invoiceStatus!: string;
  // E-invoice-ready (Doc 6 §13.4) — stored only.
  @Column({ name: 'irn', type: 'varchar', nullable: true }) irn!: string | null;
  @Column({ name: 'ack_number', type: 'varchar', nullable: true }) ackNumber!: string | null;
  @Column({ name: 'ack_date', type: 'timestamptz', nullable: true }) ackDate!: Date | null;
  @Column({ name: 'signed_qr_code', type: 'text', nullable: true }) signedQrCode!: string | null;
  @Column({ name: 'einvoice_status', type: 'varchar', default: 'not_generated' }) einvoiceStatus!: string;
  // E-way-bill-ready (Doc 6 §13.5) — stored only.
  @Column({ name: 'eway_bill_no', type: 'varchar', nullable: true }) ewayBillNo!: string | null;
  @Column({ name: 'eway_bill_date', type: 'timestamptz', nullable: true }) ewayBillDate!: Date | null;
  @Column({ name: 'eway_valid_until', type: 'timestamptz', nullable: true }) ewayValidUntil!: Date | null;
  @Column({ name: 'distance_km', type: 'int', nullable: true }) distanceKm!: number | null;
  @Column({ name: 'transport_mode', type: 'varchar', nullable: true }) transportMode!: string | null;
  @Column({ name: 'transporter_name', type: 'varchar', nullable: true }) transporterName!: string | null;
  /** Optional link to the transporter master — sources the e-way TransId/TransName. */
  @Column({ name: 'transporter_id', type: 'uuid', nullable: true }) transporterId!: string | null;
  @Column({ name: 'vehicle_no', type: 'varchar', nullable: true }) vehicleNo!: string | null;
  @Column({ name: 'eway_status', type: 'varchar', default: 'not_generated' }) ewayStatus!: string;
}

/** Invoice line — GENERIC quantity + hsn_sac + uom + cess (Doc 6 §13.2, residual #1). */
@Entity('invoice_items')
export class InvoiceItem extends TenantScopedEntity {
  @Column({ name: 'invoice_id', type: 'uuid' }) invoiceId!: string;
  @Column({ name: 'challan_id', type: 'uuid', nullable: true }) challanId!: string | null;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'description', type: 'varchar', nullable: true }) description!: string | null;
  @Column({ name: 'hsn_sac', type: 'varchar', nullable: true }) hsnSac!: string | null;
  @Column({ name: 'uom', type: 'varchar', nullable: true }) uom!: string | null;
  @Column({ name: 'quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) quantity!: string;
  @Column({ name: 'rate', type: 'numeric', precision: 14, scale: 2, default: 0 }) rate!: string;
  @Column({ name: 'taxable_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) taxableAmount!: string;
  @Column({ name: 'gst_rate', type: 'numeric', precision: 6, scale: 2, default: 0 }) gstRate!: string;
  @Column({ name: 'cgst_rate', type: 'numeric', precision: 6, scale: 2, default: 0 }) cgstRate!: string;
  @Column({ name: 'cgst_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) cgstAmount!: string;
  @Column({ name: 'sgst_rate', type: 'numeric', precision: 6, scale: 2, default: 0 }) sgstRate!: string;
  @Column({ name: 'sgst_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) sgstAmount!: string;
  @Column({ name: 'igst_rate', type: 'numeric', precision: 6, scale: 2, default: 0 }) igstRate!: string;
  @Column({ name: 'igst_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) igstAmount!: string;
  @Column({ name: 'cess_rate', type: 'numeric', precision: 6, scale: 2, default: 0 }) cessRate!: string;
  @Column({ name: 'cess_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) cessAmount!: string;
  @Column({ name: 'line_total', type: 'numeric', precision: 16, scale: 2, default: 0 }) lineTotal!: string;
}

/** Maps delivery challans to an invoice (Doc 6 §13.3). */
@Entity('invoice_challans')
export class InvoiceChallan extends TenantScopedEntity {
  @Column({ name: 'invoice_id', type: 'uuid' }) invoiceId!: string;
  @Column({ name: 'challan_id', type: 'uuid' }) challanId!: string;
  @Column({ name: 'quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) quantityM3!: string;
}

/** Customer receipt / payment (Doc 6 §13.6). */
@Entity('payments')
@Unique('uq_payments_no', ['tenantId', 'receiptNo'])
export class Payment extends TenantScopedEntity {
  @Column({ name: 'receipt_no', type: 'varchar' }) receiptNo!: string;
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ name: 'receipt_date', type: 'date', nullable: true }) receiptDate!: string | null;
  @Column({ name: 'payment_mode', type: 'varchar', nullable: true }) paymentMode!: string | null;
  @Column({ name: 'amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) amount!: string;
  @Column({ name: 'allocated_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) allocatedAmount!: string;
  @Column({ name: 'unallocated_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) unallocatedAmount!: string;
  @Column({ name: 'bank_reference', type: 'varchar', nullable: true }) bankReference!: string | null;
  @Column({ name: 'is_advance', type: 'boolean', default: false }) isAdvance!: boolean;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'posted' }) status!: string;
  /** Cheque clearing lifecycle: null/cleared for instant modes; pending → realised | bounced. */
  @Column({ name: 'clearing_status', type: 'varchar', nullable: true }) clearingStatus!: string | null;
}

/** Maps receipts to invoices (Doc 6 §13.7). */
@Entity('payment_allocations')
export class PaymentAllocation extends TenantScopedEntity {
  @Column({ name: 'payment_id', type: 'uuid' }) paymentId!: string;
  @Column({ name: 'invoice_id', type: 'uuid' }) invoiceId!: string;
  @Column({ name: 'allocated_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) allocatedAmount!: string;
}
