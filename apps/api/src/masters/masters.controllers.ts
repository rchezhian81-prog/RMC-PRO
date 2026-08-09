import { Controller, UseGuards } from '@nestjs/common';
import { BaseCrudController } from '../common/base-crud.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { CrudPermissionsGuard } from '../rbac/crud-permissions.guard';
import { CrudResource } from '../rbac/crud-resource.decorator';
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
@CrudResource('masters')
@RequireModule('masters')
@UseGuards(JwtAuthGuard, TenantGuard, CrudPermissionsGuard)
export class CustomersController extends BaseCrudController<Customer> {
  constructor(protected readonly service: CustomersService) {
    super();
  }
}

@Controller('sites')
@CrudResource('masters')
@RequireModule('masters')
@UseGuards(JwtAuthGuard, TenantGuard, CrudPermissionsGuard)
export class SitesController extends BaseCrudController<Site> {
  constructor(protected readonly service: SitesService) {
    super();
  }
}

@Controller('materials')
@CrudResource('masters')
@RequireModule('masters')
@UseGuards(JwtAuthGuard, TenantGuard, CrudPermissionsGuard)
export class MaterialsController extends BaseCrudController<Material> {
  constructor(protected readonly service: MaterialsService) {
    super();
  }
}

@Controller('suppliers')
@CrudResource('masters')
@RequireModule('masters')
@UseGuards(JwtAuthGuard, TenantGuard, CrudPermissionsGuard)
export class SuppliersController extends BaseCrudController<Supplier> {
  constructor(protected readonly service: SuppliersService) {
    super();
  }
}

@Controller('vehicles')
@CrudResource('masters')
@RequireModule('masters')
@UseGuards(JwtAuthGuard, TenantGuard, CrudPermissionsGuard)
export class VehiclesController extends BaseCrudController<Vehicle> {
  constructor(protected readonly service: VehiclesService) {
    super();
  }
}

@Controller('drivers')
@CrudResource('masters')
@RequireModule('masters')
@UseGuards(JwtAuthGuard, TenantGuard, CrudPermissionsGuard)
export class DriversController extends BaseCrudController<Driver> {
  constructor(protected readonly service: DriversService) {
    super();
  }
}

@Controller('concrete-grades')
@CrudResource('masters')
@RequireModule('masters')
@UseGuards(JwtAuthGuard, TenantGuard, CrudPermissionsGuard)
export class GradesController extends BaseCrudController<ConcreteGrade> {
  constructor(protected readonly service: GradesService) {
    super();
  }
}
