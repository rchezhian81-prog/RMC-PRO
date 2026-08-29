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
  // Money, so numeric(16,2): int truncated paise and any sub-rupee opening balance.
  @Column({ name: 'credit_limit', type: 'numeric', precision: 16, scale: 2, default: 0 }) creditLimit!: string;
  @Column({ name: 'credit_days', type: 'int', default: 0 }) creditDays!: number;
  @Column({ name: 'opening_balance', type: 'numeric', precision: 16, scale: 2, default: 0 }) openingBalance!: string;
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
  @Column({ name: 'pincode', type: 'varchar', length: 6, nullable: true }) pincode!: string | null;
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
  // Per-unit purchase price, so numeric(14,2): int dropped the paise.
  @Column({ name: 'standard_rate', type: 'numeric', precision: 14, scale: 2, default: 0 }) standardRate!: string;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
  // Batching properties (Plan A1) — feed moisture/water correction (A2).
  /** cement | fine_aggregate | coarse_aggregate | water | admixture | additive | other */
  @Column({ name: 'material_type', type: 'varchar', nullable: true }) materialType!: string | null;
  @Column({ name: 'specific_gravity', type: 'numeric', precision: 6, scale: 3, nullable: true }) specificGravity!: string | null;
  @Column({ name: 'bulk_density', type: 'numeric', precision: 10, scale: 3, nullable: true }) bulkDensity!: string | null;
  /** SSD water absorption of an aggregate, as a percentage of dry mass. */
  @Column({ name: 'water_absorption_pct', type: 'numeric', precision: 6, scale: 3, nullable: true }) waterAbsorptionPct!: string | null;
  /** Default free-surface moisture, as a percentage of dry mass. */
  @Column({ name: 'default_moisture_pct', type: 'numeric', precision: 6, scale: 3, nullable: true }) defaultMoisturePct!: string | null;
}

/** Unit-of-measure master (Plan A1) — replaces free-text UOM strings. */
@Entity('uoms')
@Unique('uq_uoms_code', ['tenantId', 'uomCode'])
export class Uom extends TenantScopedEntity {
  @Column({ name: 'uom_code', type: 'varchar' }) uomCode!: string;
  @Column({ name: 'uom_name', type: 'varchar' }) uomName!: string;
  /** weight | volume | count | length | area — conversions are valid within one category. */
  @Column({ name: 'uom_category', type: 'varchar', nullable: true }) uomCategory!: string | null;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/** Pairwise unit conversion (Plan A1): 1 `from_uom` = `factor` × `to_uom`. */
@Entity('uom_conversions')
@Unique('uq_uom_conversions', ['tenantId', 'fromUom', 'toUom'])
export class UomConversion extends TenantScopedEntity {
  @Column({ name: 'from_uom', type: 'varchar' }) fromUom!: string;
  @Column({ name: 'to_uom', type: 'varchar' }) toUom!: string;
  @Column({ name: 'factor', type: 'numeric', precision: 18, scale: 6 }) factor!: string;
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
