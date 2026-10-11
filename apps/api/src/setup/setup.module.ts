import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import {
  CompanyController,
  NumberSeriesController,
  PlanUsageController,
  RolesController,
  SettingsController,
  UserFilesController,
  UsersController,
} from './setup.controllers';
import {
  CompanyService,
  NumberSeriesService,
  RolesService,
  SettingsService,
  UsersService,
} from './setup.services';
import { NumberingService } from '../sales/numbering.service';

@Module({
  controllers: [
    CompanyController,
    SettingsController,
    NumberSeriesController,
    PlanUsageController,
    UsersController,
    UserFilesController,
    RolesController,
  ],
  providers: [
    CompanyService,
    SettingsService,
    NumberSeriesService,
    UsersService,
    RolesService,
    // Employee codes left blank are numbered from the `employee` series.
    NumberingService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class SetupModule {}
