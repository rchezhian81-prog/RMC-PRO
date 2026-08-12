import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { CustomersService, MaterialsService, SuppliersService } from '../masters/masters.services';

/**
 * Bulk import framework (Plan F1). Reuses the masters' own create services so an
 * imported row is validated exactly like a hand-keyed one. Not gated behind a
 * subscription module — an onboarding accelerator available to every tenant,
 * permission-gated (`imports.view` / `imports.run`).
 */
@Module({
  controllers: [ImportController],
  providers: [
    ImportService,
    CustomersService,
    MaterialsService,
    SuppliersService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class ImportModule {}
