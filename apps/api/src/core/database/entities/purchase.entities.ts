import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Purchase / AP-lite (Plan D2). Procurement of cement / aggregate / admixture /
 * diesel: purchase order → goods receipt (multi-line GRN, posts to the stock
 * ledger) → vendor bill (3-way matched PO ↔ GRN ↔ bill) → vendor payment. All
 * tenant-scoped under the same FORCE-RLS policy as the rest of the schema, money
 * columns numeric(16,2), quantities numeric(16,3). Reuses the `suppliers` master.
 */

/** Purchase order header (Doc: procurement). */
@Entity('purchase_orders')
@Unique('uq_purchase_orders_no', ['tenantId', 'poNo'])
export class PurchaseOrder extends TenantScopedEntity {
  @Column({ name: 'po_no', type: 'varchar' }) poNo!: string;
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true }) supplierId!: string | null;
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'order_date', type: 'date', nullable: true }) orderDate!: string | null;
  @Column({ name: 'expected_date', type: 'date', nullable: true }) expectedDate!: string | null;
  @Column({ name: 'taxable_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) taxableAmount!: string;
  @Column({ name: 'tax_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) taxAmount!: string;
  @Column({ name: 'total_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) totalAmount!: string;
  /** draft → issued → partially_received → received → closed; or cancelled. */
  @Column({ name: 'status', type: 'varchar', default: 'draft' }) status!: string;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}

/** Purchase order line — a material + ordered quantity at a rate. */
@Entity('purchase_order_items')
export class PurchaseOrderItem extends TenantScopedEntity {
  @Column({ name: 'purchase_order_id', type: 'uuid' }) purchaseOrderId!: string;
  @Column({ name: 'material_id', type: 'uuid', nullable: true }) materialId!: string | null;
  @Column({ name: 'material_label', type: 'varchar', nullable: true }) materialLabel!: string | null;
  @Column({ name: 'uom', type: 'varchar', nullable: true }) uom!: string | null;
  @Column({ name: 'quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) quantity!: string;
  @Column({ name: 'rate', type: 'numeric', precision: 14, scale: 2, default: 0 }) rate!: string;
  @Column({ name: 'gst_rate', type: 'numeric', precision: 6, scale: 2, default: 0 }) gstRate!: string;
  @Column({ name: 'taxable_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) taxableAmount!: string;
  @Column({ name: 'tax_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) taxAmount!: string;
  @Column({ name: 'line_total', type: 'numeric', precision: 16, scale: 2, default: 0 }) lineTotal!: string;
  /** Running total received against this line (from posted GRNs) — drives PO status. */
  @Column({ name: 'received_quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) receivedQuantity!: string;
}

/** Goods receipt (multi-line GRN) header — posting increases stock. */
@Entity('goods_receipts')
@Unique('uq_goods_receipts_no', ['tenantId', 'grnNo'])
export class GoodsReceipt extends TenantScopedEntity {
  @Column({ name: 'grn_no', type: 'varchar' }) grnNo!: string;
  @Column({ name: 'purchase_order_id', type: 'uuid', nullable: true }) purchaseOrderId!: string | null;
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true }) supplierId!: string | null;
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'receipt_date', type: 'date', nullable: true }) receiptDate!: string | null;
  @Column({ name: 'vehicle_no', type: 'varchar', nullable: true }) vehicleNo!: string | null;
  @Column({ name: 'supplier_challan_no', type: 'varchar', nullable: true }) supplierChallanNo!: string | null;
  /** draft → posted (stock updated); or cancelled. */
  @Column({ name: 'status', type: 'varchar', default: 'draft' }) status!: string;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}

/** Goods receipt line — received + accepted quantity for a material. */
@Entity('goods_receipt_items')
export class GoodsReceiptItem extends TenantScopedEntity {
  @Column({ name: 'goods_receipt_id', type: 'uuid' }) goodsReceiptId!: string;
  /** Optional link back to the PO line this fulfils (for roll-up + 3-way match). */
  @Column({ name: 'purchase_order_item_id', type: 'uuid', nullable: true }) purchaseOrderItemId!: string | null;
  @Column({ name: 'material_id', type: 'uuid', nullable: true }) materialId!: string | null;
  @Column({ name: 'material_label', type: 'varchar', nullable: true }) materialLabel!: string | null;
  @Column({ name: 'uom', type: 'varchar', nullable: true }) uom!: string | null;
  @Column({ name: 'received_quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) receivedQuantity!: string;
  @Column({ name: 'accepted_quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) acceptedQuantity!: string;
  @Column({ name: 'rate', type: 'numeric', precision: 14, scale: 2, default: 0 }) rate!: string;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}

/** Vendor bill header — the supplier's invoice, 3-way matched against PO + GRN. */
@Entity('vendor_bills')
@Unique('uq_vendor_bills_no', ['tenantId', 'billNo'])
export class VendorBill extends TenantScopedEntity {
  @Column({ name: 'bill_no', type: 'varchar' }) billNo!: string;
  /** The supplier's own invoice number (as printed on their bill). */
  @Column({ name: 'supplier_bill_no', type: 'varchar', nullable: true }) supplierBillNo!: string | null;
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true }) supplierId!: string | null;
  @Column({ name: 'purchase_order_id', type: 'uuid', nullable: true }) purchaseOrderId!: string | null;
  @Column({ name: 'goods_receipt_id', type: 'uuid', nullable: true }) goodsReceiptId!: string | null;
  @Column({ name: 'bill_date', type: 'date', nullable: true }) billDate!: string | null;
  @Column({ name: 'due_date', type: 'date', nullable: true }) dueDate!: string | null;
  @Column({ name: 'taxable_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) taxableAmount!: string;
  @Column({ name: 'tax_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) taxAmount!: string;
  @Column({ name: 'total_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) totalAmount!: string;
  @Column({ name: 'paid_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) paidAmount!: string;
  @Column({ name: 'outstanding_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) outstandingAmount!: string;
  /** 3-way match outcome at approval: matched | over_tolerance | unmatched. */
  @Column({ name: 'match_status', type: 'varchar', nullable: true }) matchStatus!: string | null;
  /** draft → approved; or cancelled. */
  @Column({ name: 'status', type: 'varchar', default: 'draft' }) status!: string;
  @Column({ name: 'payment_status', type: 'varchar', default: 'unpaid' }) paymentStatus!: string;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}

/** Vendor bill line. */
@Entity('vendor_bill_items')
export class VendorBillItem extends TenantScopedEntity {
  @Column({ name: 'vendor_bill_id', type: 'uuid' }) vendorBillId!: string;
  @Column({ name: 'purchase_order_item_id', type: 'uuid', nullable: true }) purchaseOrderItemId!: string | null;
  @Column({ name: 'material_id', type: 'uuid', nullable: true }) materialId!: string | null;
  @Column({ name: 'material_label', type: 'varchar', nullable: true }) materialLabel!: string | null;
  @Column({ name: 'uom', type: 'varchar', nullable: true }) uom!: string | null;
  @Column({ name: 'quantity', type: 'numeric', precision: 16, scale: 3, default: 0 }) quantity!: string;
  @Column({ name: 'rate', type: 'numeric', precision: 14, scale: 2, default: 0 }) rate!: string;
  @Column({ name: 'gst_rate', type: 'numeric', precision: 6, scale: 2, default: 0 }) gstRate!: string;
  @Column({ name: 'taxable_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) taxableAmount!: string;
  @Column({ name: 'tax_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) taxAmount!: string;
  @Column({ name: 'line_total', type: 'numeric', precision: 16, scale: 2, default: 0 }) lineTotal!: string;
}

/** Vendor payment — money paid to a supplier, allocated across their bills. */
@Entity('vendor_payments')
@Unique('uq_vendor_payments_no', ['tenantId', 'paymentNo'])
export class VendorPayment extends TenantScopedEntity {
  @Column({ name: 'payment_no', type: 'varchar' }) paymentNo!: string;
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true }) supplierId!: string | null;
  @Column({ name: 'payment_date', type: 'date', nullable: true }) paymentDate!: string | null;
  @Column({ name: 'payment_mode', type: 'varchar', nullable: true }) paymentMode!: string | null;
  @Column({ name: 'amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) amount!: string;
  @Column({ name: 'allocated_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) allocatedAmount!: string;
  @Column({ name: 'unallocated_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) unallocatedAmount!: string;
  @Column({ name: 'bank_reference', type: 'varchar', nullable: true }) bankReference!: string | null;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'posted' }) status!: string;
}

/** Maps a vendor payment to the bills it settles. */
@Entity('vendor_payment_allocations')
export class VendorPaymentAllocation extends TenantScopedEntity {
  @Column({ name: 'vendor_payment_id', type: 'uuid' }) vendorPaymentId!: string;
  @Column({ name: 'vendor_bill_id', type: 'uuid' }) vendorBillId!: string;
  @Column({ name: 'allocated_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) allocatedAmount!: string;
}
