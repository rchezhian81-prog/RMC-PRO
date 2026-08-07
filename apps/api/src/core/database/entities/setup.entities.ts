import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Company inside a tenant (Design Doc 6 §5.1) — the plant's own legal identity,
 * as it must appear on a GST tax invoice: registered name, address, GSTIN/PAN,
 * contact and the bank details customers pay into.
 */
@Entity('companies')
export class Company extends TenantScopedEntity {
  @Column({ name: 'company_name', type: 'varchar' })
  companyName!: string;

  /** Registered legal name, when it differs from the trading name. */
  @Column({ name: 'legal_name', type: 'varchar', nullable: true })
  legalName!: string | null;

  @Column({ name: 'gstin', type: 'varchar', nullable: true })
  gstin!: string | null;

  @Column({ name: 'pan', type: 'varchar', nullable: true })
  pan!: string | null;

  @Column({ name: 'address_line1', type: 'varchar', nullable: true })
  addressLine1!: string | null;

  @Column({ name: 'address_line2', type: 'varchar', nullable: true })
  addressLine2!: string | null;

  @Column({ name: 'city', type: 'varchar', nullable: true })
  city!: string | null;

  @Column({ name: 'state', type: 'varchar', nullable: true })
  state!: string | null;

  @Column({ name: 'pincode', type: 'varchar', nullable: true })
  pincode!: string | null;

  @Column({ name: 'phone', type: 'varchar', nullable: true })
  phone!: string | null;

  @Column({ name: 'email', type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ name: 'website', type: 'varchar', nullable: true })
  website!: string | null;

  @Column({ name: 'bank_name', type: 'varchar', nullable: true })
  bankName!: string | null;

  @Column({ name: 'bank_account_no', type: 'varchar', nullable: true })
  bankAccountNo!: string | null;

  @Column({ name: 'bank_ifsc', type: 'varchar', nullable: true })
  bankIfsc!: string | null;

  @Column({ name: 'bank_branch', type: 'varchar', nullable: true })
  bankBranch!: string | null;
}

/** Plant (Design Doc 6 §5.3) — trimmed for the Phase-1 foundation; RLS-enforced. */
@Entity('plants')
export class Plant extends TenantScopedEntity {
  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId!: string | null;

  @Column({ name: 'plant_code', type: 'varchar' })
  plantCode!: string;

  @Column({ name: 'plant_name', type: 'varchar' })
  plantName!: string;

  @Column({ name: 'city', type: 'varchar', nullable: true })
  city!: string | null;

  @Column({ name: 'status', type: 'varchar', default: 'active' })
  status!: string;
}

/** Document numbering series (Design Doc 6 §5.4). */
@Entity('number_series')
export class NumberSeries extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true })
  plantId!: string | null;

  @Column({ name: 'document_type', type: 'varchar' })
  documentType!: string;

  @Column({ name: 'prefix', type: 'varchar', nullable: true })
  prefix!: string | null;

  @Column({ name: 'suffix', type: 'varchar', nullable: true })
  suffix!: string | null;

  @Column({ name: 'current_number', type: 'int', default: 0 })
  currentNumber!: number;

  @Column({ name: 'padding_length', type: 'int', default: 4 })
  paddingLength!: number;

  @Column({ name: 'financial_year', type: 'varchar', nullable: true })
  financialYear!: string | null;

  @Column({ name: 'reset_frequency', type: 'varchar', default: 'yearly' })
  resetFrequency!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;
}

/** Tenant-specific settings (Design Doc 6 §5.5). */
@Entity('tenant_settings')
@Unique('uq_tenant_settings_key', ['tenantId', 'settingKey'])
export class TenantSetting extends TenantScopedEntity {
  @Column({ name: 'setting_key', type: 'varchar' })
  settingKey!: string;

  @Column({ name: 'setting_value', type: 'text', nullable: true })
  settingValue!: string | null;

  @Column({ name: 'data_type', type: 'varchar', default: 'string' })
  dataType!: string;
}
