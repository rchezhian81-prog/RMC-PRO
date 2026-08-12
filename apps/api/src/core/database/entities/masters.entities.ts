import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/** Customer master (Design Doc 6 §7.1) — Phase-3 practical subset. */
@Entity('customers')
@Unique('uq_customers_code', ['tenantId', 'customerCode'])
export class Customer extends TenantScopedEntity {
  @Column({ name: 'customer_code', type: 'varchar' }) customerCode!: string;
  @Column({ name: 'customer_name', type: 'varchar' }) customerName!: string;
  @Column({ name: 'gstin', type: 'varchar', nullable: true }) gstin!: string | null;
  @Column({ name: 'customer_type', type: 'varchar', nullable: true }) customerType!: string | null;
  @Column({ name: 'billing_address', type: 'varchar', nullable: true }) billingAddress!: string | null;
  @Column({ name: 'city', type: 'varchar', nullable: true }) city!: string | null;
  @Column({ name: 'state', type: 'varchar', nullable: true }) state!: string | null;
  /** 6-digit PIN of the buyer's billing address — GST BuyerDtls.Pin / e-way toPincode. */
  @Column({ name: 'pincode', type: 'varchar', length: 6, nullable: true }) pincode!: string | null;
  @Column({ name: 'contact_person', type: 'varchar', nullable: true }) contactPerson!: string | null;
  @Column({ name: 'mobile', type: 'varchar', nullable: true }) mobile!: string | null;
  @Column({ name: 'email', type: 'varchar', nullable: true }) email!: string | null;
  @Column({ name: 'credit_limit', type: 'int', default: 0 }) creditLimit!: number;
  @Column({ name: 'credit_days', type: 'int', default: 0 }) creditDays!: number;
  @Column({ name: 'opening_balance', type: 'int', default: 0 }) openingBalance!: number;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/** Site / project (Design Doc 6 §7.3). */
@Entity('sites')
@Unique('uq_sites_code', ['tenantId', 'siteCode'])
export class Site extends TenantScopedEntity {
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ name: 'site_code', type: 'varchar' }) siteCode!: string;
  @Column({ name: 'site_name', type: 'varchar' }) siteName!: string;
  @Column({ name: 'address', type: 'varchar', nullable: true }) address!: string | null;
  @Column({ name: 'city', type: 'varchar', nullable: true }) city!: string | null;
  @Column({ name: 'state', type: 'varchar', nullable: true }) state!: string | null;
  @Column({ name: 'contact_person', type: 'varchar', nullable: true }) contactPerson!: string | null;
  @Column({ name: 'mobile', type: 'varchar', nullable: true }) mobile!: string | null;
  @Column({ name: 'pump_required', type: 'boolean', default: false }) pumpRequired!: boolean;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/** Material master (Design Doc 6 §7.4). */
@Entity('materials')
@Unique('uq_materials_code', ['tenantId', 'materialCode'])
export class Material extends TenantScopedEntity {
  @Column({ name: 'material_code', type: 'varchar' }) materialCode!: string;
  @Column({ name: 'material_name', type: 'varchar' }) materialName!: string;
  @Column({ name: 'category', type: 'varchar', nullable: true }) category!: string | null;
  @Column({ name: 'uom', type: 'varchar', nullable: true }) uom!: string | null;
  @Column({ name: 'hsn_code', type: 'varchar', nullable: true }) hsnCode!: string | null;
  @Column({ name: 'minimum_stock', type: 'int', default: 0 }) minimumStock!: number;
  @Column({ name: 'reorder_level', type: 'int', default: 0 }) reorderLevel!: number;
  @Column({ name: 'standard_rate', type: 'int', default: 0 }) standardRate!: number;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/** Supplier master (Design Doc 6 §7.5). */
@Entity('suppliers')
@Unique('uq_suppliers_code', ['tenantId', 'supplierCode'])
export class Supplier extends TenantScopedEntity {
  @Column({ name: 'supplier_code', type: 'varchar' }) supplierCode!: string;
  @Column({ name: 'supplier_name', type: 'varchar' }) supplierName!: string;
  @Column({ name: 'gstin', type: 'varchar', nullable: true }) gstin!: string | null;
  @Column({ name: 'contact_person', type: 'varchar', nullable: true }) contactPerson!: string | null;
  @Column({ name: 'mobile', type: 'varchar', nullable: true }) mobile!: string | null;
  @Column({ name: 'email', type: 'varchar', nullable: true }) email!: string | null;
  @Column({ name: 'state', type: 'varchar', nullable: true }) state!: string | null;
  @Column({ name: 'payment_terms', type: 'varchar', nullable: true }) paymentTerms!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/** Vehicle master (Design Doc 6 §7.9). */
@Entity('vehicles')
@Unique('uq_vehicles_no', ['tenantId', 'vehicleNo'])
export class Vehicle extends TenantScopedEntity {
  @Column({ name: 'vehicle_no', type: 'varchar' }) vehicleNo!: string;
  @Column({ name: 'vehicle_type', type: 'varchar', nullable: true }) vehicleType!: string | null;
  @Column({ name: 'capacity_m3', type: 'int', default: 0 }) capacityM3!: number;
  @Column({ name: 'ownership_type', type: 'varchar', nullable: true }) ownershipType!: string | null;
  @Column({ name: 'driver_id', type: 'uuid', nullable: true }) driverId!: string | null;
  @Column({ name: 'insurance_expiry', type: 'date', nullable: true }) insuranceExpiry!: string | null;
  @Column({ name: 'fitness_expiry', type: 'date', nullable: true }) fitnessExpiry!: string | null;
  @Column({ name: 'permit_expiry', type: 'date', nullable: true }) permitExpiry!: string | null;
  @Column({ name: 'pollution_expiry', type: 'date', nullable: true }) pollutionExpiry!: string | null;
  @Column({ name: 'road_tax_expiry', type: 'date', nullable: true }) roadTaxExpiry!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'available' }) status!: string;
}

/** Driver master (Design Doc 6 §7.10). */
@Entity('drivers')
@Unique('uq_drivers_code', ['tenantId', 'driverCode'])
export class Driver extends TenantScopedEntity {
  @Column({ name: 'driver_code', type: 'varchar' }) driverCode!: string;
  @Column({ name: 'driver_name', type: 'varchar' }) driverName!: string;
  @Column({ name: 'mobile', type: 'varchar', nullable: true }) mobile!: string | null;
  @Column({ name: 'license_no', type: 'varchar', nullable: true }) licenseNo!: string | null;
  @Column({ name: 'license_expiry', type: 'date', nullable: true }) licenseExpiry!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/**
 * Transporter master (Design Doc 6 §7.x) — the managed source for the e-way
 * bill's `TransId` (GST Transporter ID / TRANSIN, or the transporter's GSTIN)
 * and `TransName`, replacing free-text transporter details on the invoice.
 */
@Entity('transporters')
@Unique('uq_transporters_code', ['tenantId', 'transporterCode'])
export class Transporter extends TenantScopedEntity {
  @Column({ name: 'transporter_code', type: 'varchar' }) transporterCode!: string;
  @Column({ name: 'transporter_name', type: 'varchar' }) transporterName!: string;
  /** 15-char GST Transporter ID (TRANSIN) or GSTIN — the e-way `TransId`. */
  @Column({ name: 'transin', type: 'varchar', length: 15, nullable: true }) transin!: string | null;
  @Column({ name: 'gstin', type: 'varchar', nullable: true }) gstin!: string | null;
  @Column({ name: 'contact_person', type: 'varchar', nullable: true }) contactPerson!: string | null;
  @Column({ name: 'mobile', type: 'varchar', nullable: true }) mobile!: string | null;
  @Column({ name: 'email', type: 'varchar', nullable: true }) email!: string | null;
  @Column({ name: 'state', type: 'varchar', nullable: true }) state!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/** Concrete grade master (Design Doc 6 §7.6). */
@Entity('concrete_grades')
@Unique('uq_grades_code', ['tenantId', 'gradeCode'])
export class ConcreteGrade extends TenantScopedEntity {
  @Column({ name: 'grade_code', type: 'varchar' }) gradeCode!: string;
  @Column({ name: 'grade_name', type: 'varchar' }) gradeName!: string;
  @Column({ name: 'strength_class', type: 'varchar', nullable: true }) strengthClass!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}
