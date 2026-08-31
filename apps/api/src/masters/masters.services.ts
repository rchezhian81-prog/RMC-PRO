import { Injectable } from '@nestjs/common';
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
