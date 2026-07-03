import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import {
  CustomersController,
  DriversController,
  GradesController,
  MaterialsController,
  SitesController,
  SuppliersController,
  VehiclesController,
} from './masters.controllers';
import {
  CustomersService,
  DriversService,
  GradesService,
  MaterialsService,
  SitesService,
  SuppliersService,
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
  ],
  providers: [
    CustomersService,
    SitesService,
    MaterialsService,
    SuppliersService,
    VehiclesService,
    DriversService,
    GradesService,
    TenantGuard,
  ],
})
export class MastersModule {}
