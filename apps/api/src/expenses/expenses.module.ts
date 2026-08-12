import { Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { NumberingService } from '../sales/numbering.service';
import { ExpenseGroupController, ExpenseHeadController, ExpenseVoucherController } from './expenses.controllers';
import { ExpenseGroupService, ExpenseHeadService } from './expense-master.service';
import { ExpenseVoucherService } from './expense-voucher.service';

/**
 * Expense capture (Plan D4). Two masters (expense groups → heads) and expense
 * vouchers whose lines carry a cost allocation (plant / vehicle / site) that
 * drives a spend-by-cost-object report. Gated behind the `expenses` subscription
 * module. `AuditService` is injected from the global AuditModule; posting a
 * voucher is audited. `NumberingService` provides voucher numbers.
 */
@Module({
  controllers: [ExpenseGroupController, ExpenseHeadController, ExpenseVoucherController],
  providers: [
    ExpenseGroupService,
    ExpenseHeadService,
    ExpenseVoucherService,
    NumberingService,
    TenantGuard,
    PermissionsGuard,
  ],
})
export class ExpensesModule {}
