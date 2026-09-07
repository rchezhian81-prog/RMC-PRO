import { BadRequestException, Injectable } from '@nestjs/common';
import { validateMasterFields } from '@rmc/shared';
import { AuditService } from '../audit/audit.service';
import { TenantCrudService } from '../common/tenant-crud.service';
import { assertFields } from '../common/validation';
import { TenantDbService } from '../core/database/tenant-db.service';
import { computeCustomerExposure } from '../orders/exposure.util';
import {
  ConcreteGrade,
  Customer,
  Driver,
  Material,
  Site,
  Supplier,
  Transporter,
  Uom,
  UomConversion,
  Vehicle,
} from '../core/database/entities';

@Injectable()
export class CustomersService extends TenantCrudService<Customer> {
  constructor(db: TenantDbService, audit: AuditService) {
    super(db, Customer, { orderBy: 'customerCode', required: ['customerCode', 'customerName'], resource: 'customer', labelField: 'customerName' }, audit);
  }
  // GSTIN, mobile, creditLimit, creditDays.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }

  /**
   * Live credit-exposure breakdown for the customer detail / credit view — the
   * single source of truth (design plan §3): opening + un-invoiced confirmed
   * orders + issued-invoice outstanding − auto-netted advances, plus the limit
   * and available credit.
   */
  exposure(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => computeCustomerExposure(m, id));
  }
}

@Injectable()
export class SitesService extends TenantCrudService<Site> {
  constructor(db: TenantDbService, audit: AuditService) {
    super(db, Site, { orderBy: 'siteCode', required: ['siteCode', 'siteName'], resource: 'site', labelField: 'siteName' }, audit);
  }
  // Mobile.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}

@Injectable()
export class MaterialsService extends TenantCrudService<Material> {
  constructor(db: TenantDbService, audit: AuditService) {
    super(db, Material, { orderBy: 'materialCode', required: ['materialCode', 'materialName'], resource: 'material', labelField: 'materialName' }, audit);
  }
  // material_type + specific gravity / bulk density / absorption / moisture.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }

  /**
   * The unit of measure is frozen once stock exists for the material (data-
   * integrity item I39). Stock balances and the ledger carry quantities but no
   * unit, and the weighbridge scales net kg by the LIVE material uom (MT → kg is
   * 1000×): flipping cement from MT to kg after 160 MT exists booked the next
   * 25 t truck as 25,000 into a balance labelled MT, and valuation multiplied a
   * mixed-scale quantity by the rate with nothing in the ledger to reconstruct
   * it. A re-base with a conversion factor is a feature, not a fix — until it
   * exists, create a new material for the new unit.
   */
  override async update(tenantId: string, id: string, dto: Record<string, unknown>, userId?: string | null): Promise<Material> {
    if (dto.uom !== undefined && dto.uom !== null) {
      await this.db.runInTenant(tenantId, async (m) => {
        const row = await m.getRepository(Material).findOne({ where: { id } });
        const next = String(dto.uom).trim();
        if (!row || !row.uom || next === row.uom) return;
        const [refs] = (await m.query(
          `SELECT (SELECT count(*) FROM stock_transactions WHERE material_id = $1)
                + (SELECT count(*) FROM stock_balances WHERE material_id = $1)
                + (SELECT count(*) FROM material_inwards WHERE material_id = $1) AS n`,
          [id],
        )) as Array<{ n: number | string }>;
        if (Number(refs?.n ?? 0) > 0) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: `Unit of measure cannot be changed from ${row.uom} to ${next}: stock movements already exist for this material and the ledger has no unit marker to re-base them. Create a new material for the new unit instead.`,
          });
        }
      });
    }
    return super.update(tenantId, id, dto, userId);
  }
}

@Injectable()
export class SuppliersService extends TenantCrudService<Supplier> {
  constructor(db: TenantDbService, audit: AuditService) {
    super(db, Supplier, { orderBy: 'supplierCode', required: ['supplierCode', 'supplierName'], resource: 'supplier', labelField: 'supplierName' }, audit);
  }
  // GSTIN, mobile.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}

@Injectable()
export class VehiclesService extends TenantCrudService<Vehicle> {
  constructor(db: TenantDbService, audit: AuditService) {
    super(db, Vehicle, { orderBy: 'vehicleNo', required: ['vehicleNo'], resource: 'vehicle', labelField: 'vehicleNo' }, audit);
  }
  // capacityM3 must be >= 0.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}

@Injectable()
export class DriversService extends TenantCrudService<Driver> {
  constructor(db: TenantDbService, audit: AuditService) {
    super(db, Driver, { orderBy: 'driverCode', required: ['driverCode', 'driverName'], resource: 'driver', labelField: 'driverName' }, audit);
  }
  // Mobile.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}

@Injectable()
export class GradesService extends TenantCrudService<ConcreteGrade> {
  constructor(db: TenantDbService, audit: AuditService) {
    super(db, ConcreteGrade, { orderBy: 'gradeCode', required: ['gradeCode', 'gradeName'], resource: 'grade', labelField: 'gradeName' }, audit);
  }
}

@Injectable()
export class TransportersService extends TenantCrudService<Transporter> {
  constructor(db: TenantDbService, audit: AuditService) {
    super(db, Transporter, { orderBy: 'transporterCode', required: ['transporterCode', 'transporterName'], resource: 'transporter', labelField: 'transporterName' }, audit);
  }
  // GSTIN, TRANSIN, mobile.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}

@Injectable()
export class UomsService extends TenantCrudService<Uom> {
  constructor(db: TenantDbService, audit: AuditService) {
    super(db, Uom, { orderBy: 'uomCode', required: ['uomCode', 'uomName'], resource: 'uom', labelField: 'uomName' }, audit);
  }
}

@Injectable()
export class UomConversionsService extends TenantCrudService<UomConversion> {
  constructor(db: TenantDbService, audit: AuditService) {
    super(db, UomConversion, { orderBy: 'fromUom', required: ['fromUom', 'toUom', 'factor'], hardDelete: true, resource: 'uom_conversion', labelField: 'fromUom' }, audit);
  }
  // factor must be a positive number.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}
