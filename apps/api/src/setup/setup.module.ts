import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import {
  CompanyController,
  NumberSeriesController,
  PlanUsageController,
  RolesController,
  SettingsController,
  UsersController,
} from './setup.controllers';
import {
  CompanyService,
  NumberSeriesService,
  RolesService,
  SettingsService,
  UsersService,
} from './setup.services';

@Module({
  controllers: [
    CompanyController,
    SettingsController,
    NumberSeriesController,
    PlanUsageController,
    UsersController,
    RolesController,
  ],
  providers: [
    CompanyService,
    SettingsService,
    NumberSeriesService,
    UsersService,
    RolesService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class SetupModule {}
