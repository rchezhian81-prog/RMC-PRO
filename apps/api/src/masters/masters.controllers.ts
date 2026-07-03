import { Controller, UseGuards } from '@nestjs/common';
import { BaseCrudController } from '../common/base-crud.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import {
  ConcreteGrade,
  Customer,
  Driver,
  Material,
  Site,
  Supplier,
  Vehicle,
} from '../core/database/entities';
import {
  CustomersService,
  DriversService,
  GradesService,
  MaterialsService,
  SitesService,
  SuppliersService,
  VehiclesService,
} from './masters.services';

@Controller('customers')
@UseGuards(JwtAuthGuard, TenantGuard)
export class CustomersController extends BaseCrudController<Customer> {
  constructor(protected readonly service: CustomersService) {
    super();
  }
}

@Controller('sites')
@UseGuards(JwtAuthGuard, TenantGuard)
export class SitesController extends BaseCrudController<Site> {
  constructor(protected readonly service: SitesService) {
    super();
  }
}

@Controller('materials')
@UseGuards(JwtAuthGuard, TenantGuard)
export class MaterialsController extends BaseCrudController<Material> {
  constructor(protected readonly service: MaterialsService) {
    super();
  }
}

@Controller('suppliers')
@UseGuards(JwtAuthGuard, TenantGuard)
export class SuppliersController extends BaseCrudController<Supplier> {
  constructor(protected readonly service: SuppliersService) {
    super();
  }
}

@Controller('vehicles')
@UseGuards(JwtAuthGuard, TenantGuard)
export class VehiclesController extends BaseCrudController<Vehicle> {
  constructor(protected readonly service: VehiclesService) {
    super();
  }
}

@Controller('drivers')
@UseGuards(JwtAuthGuard, TenantGuard)
export class DriversController extends BaseCrudController<Driver> {
  constructor(protected readonly service: DriversService) {
    super();
  }
}

@Controller('concrete-grades')
@UseGuards(JwtAuthGuard, TenantGuard)
export class GradesController extends BaseCrudController<ConcreteGrade> {
  constructor(protected readonly service: GradesService) {
    super();
  }
}
