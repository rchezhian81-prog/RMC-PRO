import { Injectable } from '@nestjs/common';
import { validateMasterFields } from '@rmc/shared';
import { TenantCrudService } from '../common/tenant-crud.service';
import { assertFields } from '../common/validation';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  ConcreteGrade,
  Customer,
  Driver,
  Material,
  Site,
  Supplier,
  Transporter,
  Vehicle,
} from '../core/database/entities';

@Injectable()
export class CustomersService extends TenantCrudService<Customer> {
  constructor(db: TenantDbService) {
    super(db, Customer, { orderBy: 'customerCode', required: ['customerCode', 'customerName'] });
  }
  // GSTIN, mobile, creditLimit, creditDays.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}

@Injectable()
export class SitesService extends TenantCrudService<Site> {
  constructor(db: TenantDbService) {
    super(db, Site, { orderBy: 'siteCode', required: ['siteCode', 'siteName'] });
  }
  // Mobile.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}

@Injectable()
export class MaterialsService extends TenantCrudService<Material> {
  constructor(db: TenantDbService) {
    super(db, Material, { orderBy: 'materialCode', required: ['materialCode', 'materialName'] });
  }
}

@Injectable()
export class SuppliersService extends TenantCrudService<Supplier> {
  constructor(db: TenantDbService) {
    super(db, Supplier, { orderBy: 'supplierCode', required: ['supplierCode', 'supplierName'] });
  }
  // GSTIN, mobile.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}

@Injectable()
export class VehiclesService extends TenantCrudService<Vehicle> {
  constructor(db: TenantDbService) {
    super(db, Vehicle, { orderBy: 'vehicleNo', required: ['vehicleNo'] });
  }
  // capacityM3 must be >= 0.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}

@Injectable()
export class DriversService extends TenantCrudService<Driver> {
  constructor(db: TenantDbService) {
    super(db, Driver, { orderBy: 'driverCode', required: ['driverCode', 'driverName'] });
  }
  // Mobile.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}

@Injectable()
export class GradesService extends TenantCrudService<ConcreteGrade> {
  constructor(db: TenantDbService) {
    super(db, ConcreteGrade, { orderBy: 'gradeCode', required: ['gradeCode', 'gradeName'] });
  }
}

@Injectable()
export class TransportersService extends TenantCrudService<Transporter> {
  constructor(db: TenantDbService) {
    super(db, Transporter, { orderBy: 'transporterCode', required: ['transporterCode', 'transporterName'] });
  }
  // GSTIN, TRANSIN, mobile.
  protected override validateWrite(dto: Record<string, unknown>): void {
    assertFields(validateMasterFields(dto));
  }
}
