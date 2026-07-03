import { Injectable } from '@nestjs/common';
import { TenantCrudService } from '../common/tenant-crud.service';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  ConcreteGrade,
  Customer,
  Driver,
  Material,
  Site,
  Supplier,
  Vehicle,
} from '../core/database/entities';

@Injectable()
export class CustomersService extends TenantCrudService<Customer> {
  constructor(db: TenantDbService) {
    super(db, Customer, { orderBy: 'customerCode', required: ['customerCode', 'customerName'] });
  }
}

@Injectable()
export class SitesService extends TenantCrudService<Site> {
  constructor(db: TenantDbService) {
    super(db, Site, { orderBy: 'siteCode', required: ['siteCode', 'siteName'] });
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
}

@Injectable()
export class VehiclesService extends TenantCrudService<Vehicle> {
  constructor(db: TenantDbService) {
    super(db, Vehicle, { orderBy: 'vehicleNo', required: ['vehicleNo'] });
  }
}

@Injectable()
export class DriversService extends TenantCrudService<Driver> {
  constructor(db: TenantDbService) {
    super(db, Driver, { orderBy: 'driverCode', required: ['driverCode', 'driverName'] });
  }
}

@Injectable()
export class GradesService extends TenantCrudService<ConcreteGrade> {
  constructor(db: TenantDbService) {
    super(db, ConcreteGrade, { orderBy: 'gradeCode', required: ['gradeCode', 'gradeName'] });
  }
}
