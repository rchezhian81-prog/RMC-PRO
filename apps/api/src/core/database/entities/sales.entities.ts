import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Sprint 4 — Sales module entities (Design Doc 6 §8, Doc 6.1 R1/R2).
 * Money columns use numeric(14,2); quantities numeric(12,3). TypeORM returns
 * numeric as string — the API layer treats them as opaque decimal strings.
 */

/** Sales lead (Doc 6 §8.1). */
@Entity('leads')
@Unique('uq_leads_no', ['tenantId', 'leadNo'])
export class Lead extends TenantScopedEntity {
  @Column({ name: 'lead_no', type: 'varchar' }) leadNo!: string;
  @Column({ name: 'customer_name', type: 'varchar' }) customerName!: string;
  @Column({ name: 'contact_person', type: 'varchar', nullable: true }) contactPerson!: string | null;
  @Column({ name: 'mobile', type: 'varchar', nullable: true }) mobile!: string | null;
  @Column({ name: 'email', type: 'varchar', nullable: true }) email!: string | null;
  @Column({ name: 'site_location', type: 'varchar', nullable: true }) siteLocation!: string | null;
  @Column({ name: 'requirement_notes', type: 'text', nullable: true }) requirementNotes!: string | null;
  @Column({ name: 'lead_source', type: 'varchar', nullable: true }) leadSource!: string | null;
  @Column({ name: 'assigned_sales_user_id', type: 'uuid', nullable: true }) assignedSalesUserId!: string | null;
  @Column({ name: 'lead_stage', type: 'varchar', default: 'new' }) leadStage!: string;
  @Column({ name: 'next_followup_date', type: 'date', nullable: true }) nextFollowupDate!: string | null;
  @Column({ name: 'lost_reason', type: 'varchar', nullable: true }) lostReason!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'open' }) status!: string;
}

/** Lead follow-up entry (Doc 6 §8.1). */
@Entity('lead_followups')
export class LeadFollowup extends TenantScopedEntity {
  @Column({ name: 'lead_id', type: 'uuid' }) leadId!: string;
  @Column({ name: 'followup_date', type: 'date', nullable: true }) followupDate!: string | null;
  @Column({ name: 'notes', type: 'text', nullable: true }) notes!: string | null;
  @Column({ name: 'outcome', type: 'varchar', nullable: true }) outcome!: string | null;
  @Column({ name: 'next_followup_date', type: 'date', nullable: true }) nextFollowupDate!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'done' }) status!: string;
}

/** Quotation header (Doc 6 §8.2). */
@Entity('quotations')
@Unique('uq_quotations_no', ['tenantId', 'quotationNo'])
export class Quotation extends TenantScopedEntity {
  @Column({ name: 'quotation_no', type: 'varchar' }) quotationNo!: string;
  @Column({ name: 'lead_id', type: 'uuid', nullable: true }) leadId!: string | null;
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ name: 'site_id', type: 'uuid', nullable: true }) siteId!: string | null;
  @Column({ name: 'quotation_date', type: 'date', nullable: true }) quotationDate!: string | null;
  @Column({ name: 'valid_until', type: 'date', nullable: true }) validUntil!: string | null;
  @Column({ name: 'sales_user_id', type: 'uuid', nullable: true }) salesUserId!: string | null;
  @Column({ name: 'payment_terms', type: 'varchar', nullable: true }) paymentTerms!: string | null;
  @Column({ name: 'approval_status', type: 'varchar', default: 'draft' }) approvalStatus!: string;
  @Column({ name: 'revision_no', type: 'int', default: 0 }) revisionNo!: number;
  @Column({ name: 'remarks', type: 'text', nullable: true }) remarks!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/** Quotation line item with grade-wise rate + charges (Doc 6 §8.3). */
@Entity('quotation_items')
export class QuotationItem extends TenantScopedEntity {
  @Column({ name: 'quotation_id', type: 'uuid' }) quotationId!: string;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'grade_label', type: 'varchar', nullable: true }) gradeLabel!: string | null;
  @Column({ name: 'estimated_quantity', type: 'numeric', precision: 12, scale: 3, default: 0 }) estimatedQuantity!: string;
  @Column({ name: 'rate_per_m3', type: 'numeric', precision: 14, scale: 2, default: 0 }) ratePerM3!: string;
  @Column({ name: 'transport_charge', type: 'numeric', precision: 14, scale: 2, default: 0 }) transportCharge!: string;
  @Column({ name: 'pump_charge', type: 'numeric', precision: 14, scale: 2, default: 0 }) pumpCharge!: string;
  @Column({ name: 'waiting_charge', type: 'numeric', precision: 14, scale: 2, default: 0 }) waitingCharge!: string;
  @Column({ name: 'gst_applicable', type: 'boolean', default: true }) gstApplicable!: boolean;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}

/** Quotation revision snapshot (Doc 6 §8.4). */
@Entity('quotation_revisions')
export class QuotationRevision extends TenantScopedEntity {
  @Column({ name: 'quotation_id', type: 'uuid' }) quotationId!: string;
  @Column({ name: 'revision_no', type: 'int', default: 0 }) revisionNo!: number;
  @Column({ name: 'changed_by', type: 'uuid', nullable: true }) changedBy!: string | null;
  @Column({ name: 'change_reason', type: 'varchar', nullable: true }) changeReason!: string | null;
  @Column({ name: 'snapshot_json', type: 'jsonb', nullable: true }) snapshotJson!: unknown;
}

/** Rate contract header (Doc 6.1 R2). */
@Entity('rate_contracts')
@Unique('uq_rate_contracts_no', ['tenantId', 'rateContractNo'])
export class RateContract extends TenantScopedEntity {
  @Column({ name: 'rate_contract_no', type: 'varchar' }) rateContractNo!: string;
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ name: 'site_id', type: 'uuid', nullable: true }) siteId!: string | null;
  @Column({ name: 'valid_from', type: 'date', nullable: true }) validFrom!: string | null;
  @Column({ name: 'valid_to', type: 'date', nullable: true }) validTo!: string | null;
  @Column({ name: 'transport_terms', type: 'varchar', nullable: true }) transportTerms!: string | null;
  @Column({ name: 'pump_terms', type: 'varchar', nullable: true }) pumpTerms!: string | null;
  @Column({ name: 'payment_terms', type: 'varchar', nullable: true }) paymentTerms!: string | null;
  @Column({ name: 'approval_status', type: 'varchar', default: 'draft' }) approvalStatus!: string;
  @Column({ name: 'remarks', type: 'text', nullable: true }) remarks!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/** Rate contract line item (Doc 6.1 R2). */
@Entity('rate_contract_items')
export class RateContractItem extends TenantScopedEntity {
  @Column({ name: 'rate_contract_id', type: 'uuid' }) rateContractId!: string;
  @Column({ name: 'grade_id', type: 'uuid', nullable: true }) gradeId!: string | null;
  @Column({ name: 'grade_label', type: 'varchar', nullable: true }) gradeLabel!: string | null;
  @Column({ name: 'rate_per_m3', type: 'numeric', precision: 14, scale: 2, default: 0 }) ratePerM3!: string;
  @Column({ name: 'transport_charge', type: 'numeric', precision: 14, scale: 2, default: 0 }) transportCharge!: string;
  @Column({ name: 'pump_charge', type: 'numeric', precision: 14, scale: 2, default: 0 }) pumpCharge!: string;
  @Column({ name: 'waiting_charge', type: 'numeric', precision: 14, scale: 2, default: 0 }) waitingCharge!: string;
  @Column({ name: 'gst_applicable', type: 'boolean', default: true }) gstApplicable!: boolean;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}
