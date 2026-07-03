import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import {
  CompanyController,
  NumberSeriesController,
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
  ],
})
export class SetupModule {}
