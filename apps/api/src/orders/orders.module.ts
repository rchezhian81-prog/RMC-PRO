import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { OrdersController, CreditHoldsController } from './orders.controllers';
import { OrdersService } from './orders.service';
import { CreditHoldService } from './credit-hold.service';
import { CreditService } from './credit.service';

/**
 * Sprint 5 — Orders + credit control (DEV-PLAN B8). Confirmed-order lifecycle
 * and credit-hold approval. Downstream operations (production, dispatch,
 * inventory, billing) are later sprints and intentionally absent here.
 */
@Module({
  controllers: [OrdersController, CreditHoldsController],
  providers: [OrdersService, CreditHoldService, CreditService, TenantGuard, PermissionsGuard],
})
export class OrdersModule {}
