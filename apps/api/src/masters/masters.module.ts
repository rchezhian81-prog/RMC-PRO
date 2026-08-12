import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { CrudPermissionsGuard } from '../rbac/crud-permissions.guard';
import {
  CustomersController,
  DriversController,
  GradesController,
  MaterialsController,
  SitesController,
  SuppliersController,
  TransportersController,
  VehiclesController,
} from './masters.controllers';
import {
  CustomersService,
  DriversService,
  GradesService,
  MaterialsService,
  SitesService,
  SuppliersService,
  TransportersService,
  VehiclesService,
} from './masters.services';

@Module({
  controllers: [
    CustomersController,
    SitesController,
    MaterialsController,
    SuppliersController,
    VehiclesController,
    DriversController,
    GradesController,
    TransportersController,
  ],
  providers: [
    CustomersService,
    SitesService,
    MaterialsService,
    SuppliersService,
    VehiclesService,
    DriversService,
    GradesService,
    TransportersService,
    TenantGuard,
    CrudPermissionsGuard,
  ],
})
export class MastersModule {}
